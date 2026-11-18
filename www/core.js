// Merge Defense - game logic (no DOM, testable in Node)
(function (root) {
  'use strict';

  const W = 360, H = 640;
  const COLS = 5, ROWS = 3, NSLOTS = COLS * ROWS;
  const CELL = 64, PITCH = 68;
  const GRID_X = 12, GRID_Y = 300;
  const SHOP_Y = 520, SHOP_H = 64;
  const MAXTIER = 8;
  const TIER_MULT = 2.4;
  const BASE_SPEED = 42;

  const PATH = [[-20, 80], [310, 80], [310, 150], [50, 150], [50, 220], [380, 220]];
  const SEG = [];
  let LEN = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [x1, y1] = PATH[i], [x2, y2] = PATH[i + 1];
    const l = Math.hypot(x2 - x1, y2 - y1);
    SEG.push({ x1, y1, x2, y2, l, s: LEN });
    LEN += l;
  }

  function posAt(d) {
    for (const g of SEG) {
      if (d <= g.s + g.l) {
        const t = Math.max(0, (d - g.s) / g.l);
        return [g.x1 + (g.x2 - g.x1) * t, g.y1 + (g.y2 - g.y1) * t];
      }
    }
    const last = PATH[PATH.length - 1];
    return [last[0], last[1]];
  }

  const TYPES = {
    archer: { name: 'Strijelac', emoji: '🏹', cost: 10, dmg: 6, rate: 1, splash: 0, color: '#3f9b4b' },
    gunner: { name: 'Puškar', emoji: '🔫', cost: 25, dmg: 3, rate: 3, splash: 0, color: '#3f6fcf' },
    cannon: { name: 'Top', emoji: '💣', cost: 50, dmg: 16, rate: 0.5, splash: 48, color: '#c2553a' }
  };
  const TYPE_KEYS = ['archer', 'gunner', 'cannon'];

  const ENEMIES = {
    grunt: { emoji: '🧟', hp: 1, spd: 1, rew: 1, dmg: 1 },
    runner: { emoji: '🦇', hp: 0.55, spd: 1.8, rew: 1, dmg: 1 },
    tank: { emoji: '🐗', hp: 3.2, spd: 0.65, rew: 2.5, dmg: 1 },
    boss: { emoji: '👹', hp: 22, spd: 0.55, rew: 20, dmg: 3 }
  };

  function slotPos(i) {
    const c = i % COLS, r = Math.floor(i / COLS);
    return [GRID_X + c * PITCH + CELL / 2, GRID_Y + r * PITCH + CELL / 2];
  }
  function slotAt(x, y) {
    for (let i = 0; i < NSLOTS; i++) {
      const c = i % COLS, r = Math.floor(i / COLS);
      const sx = GRID_X + c * PITCH, sy = GRID_Y + r * PITCH;
      if (x >= sx && x <= sx + CELL && y >= sy && y <= sy + CELL) return i;
    }
    return -1;
  }

  function create() {
    return {
      coins: 10, lives: 10, wave: 0, waveTimer: 7,
      queue: [], spawnCd: 0, enemies: [], slots: new Array(NSLOTS).fill(null),
      bought: { archer: 0, gunner: 0, cannon: 0 },
      shots: [], texts: [], rings: [], over: false, time: 0, kills: 0, nextId: 1
    };
  }

  function cost(s, type) {
    return Math.ceil(TYPES[type].cost * Math.pow(1.07, s.bought[type]));
  }
  function unitDmg(u) {
    return TYPES[u.type].dmg * Math.pow(TIER_MULT, u.tier - 1);
  }
  function income(s) {
    return 0.4 + 0.03 * s.wave; // coins per second
  }
  function earlyBonus(s) {
    return Math.max(0, Math.floor(s.waveTimer / 4));
  }

  function buy(s, type) {
    const c = cost(s, type);
    if (s.over) return -1;
    let slot = -1;
    for (let i = 0; i < NSLOTS; i++) if (!s.slots[i]) { slot = i; break; }
    if (slot < 0) return -2;      // no room
    if (s.coins < c) return -3;   // no coins
    s.coins -= c;
    s.bought[type]++;
    s.slots[slot] = { type, tier: 1, cd: 0.3, val: c };
    s.rings.push({ x: slotPos(slot)[0], y: slotPos(slot)[1], t: 0, c: '#ffffff' });
    return slot;
  }

  function canMerge(s, a, b) {
    const A = s.slots[a], B = s.slots[b];
    return a !== b && A && B && A.type === B.type && A.tier === B.tier && A.tier < MAXTIER;
  }

  // returns 'merge' | 'move' | 'swap' | null
  function move(s, a, b) {
    if (a === b || !s.slots[a]) return null;
    if (!s.slots[b]) {
      s.slots[b] = s.slots[a]; s.slots[a] = null; return 'move';
    }
    if (canMerge(s, a, b)) {
      const B = s.slots[b];
      B.tier++; B.val += s.slots[a].val; B.cd = 0.3;
      s.slots[a] = null;
      const p = slotPos(b);
      s.rings.push({ x: p[0], y: p[1], t: 0, c: '#ffd84a' });
      return 'merge';
    }
    const t = s.slots[a]; s.slots[a] = s.slots[b]; s.slots[b] = t;
    return 'swap';
  }

  function sell(s, a) {
    const u = s.slots[a];
    if (!u) return 0;
    const gain = Math.floor(u.val * 0.5);
    s.coins += gain;
    s.slots[a] = null;
    return gain;
  }

  function buildWave(w) {
    const n = Math.min(6 + Math.floor(w * 1.4), 45);
    const q = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let t = 'grunt';
      if (w >= 3 && r < 0.25) t = 'runner';
      else if (w >= 5 && r < 0.45) t = 'tank';
      q.push(t);
    }
    if (w % 10 === 0) q.push('boss');
    return q;
  }

  function startWave(s) {
    s.wave++;
    s.queue = s.queue.concat(buildWave(s.wave));
    s.waveTimer = 28;
  }

  function callWave(s) {
    if (s.over || s.waveTimer <= 3) return 0;
    const b = earlyBonus(s);
    s.coins += b;
    startWave(s);
    return b;
  }

  function hpFor(w, kind) {
    return 10 * Math.pow(1.16, w - 1) * (1 + 0.05 * w) * ENEMIES[kind].hp;
  }

  function spawn(s, kind) {
    const e = ENEMIES[kind];
    const hp = hpFor(s.wave, kind);
    s.enemies.push({
      id: s.nextId++, kind, hp, max: hp, d: 0, x: PATH[0][0], y: PATH[0][1],
      spd: BASE_SPEED * e.spd, reward: e.rew * (1 + 0.12 * s.wave), dmg: e.dmg
    });
  }

  function hit(s, e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.dead = true;
      s.coins += e.reward;
      s.kills++;
      s.texts.push({ x: e.x, y: e.y - 10, t: 0, s: '+' + (e.reward >= 10 ? Math.round(e.reward) : (Math.round(e.reward * 10) / 10)) });
    }
  }

  function update(s, dt) {
    if (s.over) return;
    s.time += dt;
    s.coins += income(s) * dt;

    // waves
    s.waveTimer -= dt;
    if (s.waveTimer <= 0) startWave(s);
    if (s.queue.length) {
      s.spawnCd -= dt;
      if (s.spawnCd <= 0) {
        spawn(s, s.queue.shift());
        s.spawnCd = Math.max(0.45, 0.9 - 0.015 * s.wave);
      }
    }

    // enemies
    for (const e of s.enemies) {
      e.d += e.spd * dt;
      const p = posAt(e.d);
      e.x = p[0]; e.y = p[1];
      if (e.d >= LEN && !e.dead) {
        e.dead = true; e.leaked = true;
        s.lives -= e.dmg;
        s.texts.push({ x: 330, y: e.y, t: 0, s: '-' + e.dmg + '❤️', c: '#ff6b6b' });
      }
    }

    // towers
    for (let i = 0; i < NSLOTS; i++) {
      const u = s.slots[i];
      if (!u) continue;
      u.cd -= dt;
      if (u.cd > 0) continue;
      let target = null;
      for (const e of s.enemies) {
        if (!e.dead && (!target || e.d > target.d)) target = e;
      }
      if (!target) { u.cd = 0; continue; }
      const T = TYPES[u.type];
      const dmg = unitDmg(u);
      const sp = slotPos(i);
      hit(s, target, dmg);
      if (T.splash) {
        for (const e of s.enemies) {
          if (e !== target && !e.dead && Math.hypot(e.x - target.x, e.y - target.y) <= T.splash) hit(s, e, dmg * 0.6);
        }
        s.rings.push({ x: target.x, y: target.y, t: 0, c: '#ff9a4a', r: T.splash });
      }
      s.shots.push({ x1: sp[0], y1: sp[1], x2: target.x, y2: target.y, t: 0, type: u.type });
      u.cd += 1 / T.rate;
      if (u.cd < -0.2) u.cd = 0;
    }
    s.enemies = s.enemies.filter(e => !e.dead);

    // fx
    for (const a of s.shots) a.t += dt;
    for (const a of s.texts) a.t += dt;
    for (const a of s.rings) a.t += dt;
    s.shots = s.shots.filter(a => a.t < 0.12);
    s.texts = s.texts.filter(a => a.t < 0.9);
    s.rings = s.rings.filter(a => a.t < 0.4);

    if (s.lives <= 0) { s.lives = 0; s.over = true; }
  }

  // Simple bot (used for balance testing and demo screenshots)
  function bot(s) {
    for (let i = 0; i < NSLOTS; i++)
      for (let j = i + 1; j < NSLOTS; j++)
        if (canMerge(s, i, j)) { move(s, i, j); return; }
    const count = { archer: 0, gunner: 0, cannon: 0 };
    for (const u of s.slots) if (u) count[u.type]++;
    let pick = 'archer';
    for (const k of TYPE_KEYS) if (count[k] < count[pick]) pick = k;
    if (s.coins >= cost(s, pick)) buy(s, pick);
  }

  const Core = {
    W, H, COLS, ROWS, NSLOTS, CELL, PITCH, GRID_X, GRID_Y, SHOP_Y, SHOP_H, MAXTIER, LEN, PATH,
    TYPES, TYPE_KEYS, ENEMIES, posAt, slotPos, slotAt, create, cost, unitDmg, income, earlyBonus,
    buy, canMerge, move, sell, callWave, update, bot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(this);
