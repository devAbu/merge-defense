// Merge Defense v2 - game logic (no DOM, testable in Node)
(function (root) {
  'use strict';

  // ---------- layout / constants ----------
  const W = 360, H = 740;
  const COLS = 5, ROWS = 3, NSLOTS = COLS * ROWS;
  const CELL = 64, PITCH = 68;
  const GRID_X = 12, GRID_Y = 308;
  const PANEL_Y = 516, PANEL_H = 52;
  const SHOP_Y = 576, SHOP_BH = 52, SHOP_GAP = 6;
  const MAXTIER = 8;
  const ATK_MULT = 2.4;     // damage multiplier per tier
  const ECO_MULT = 2.2;     // miner income multiplier per tier
  const BASE_SPEED = 42;
  const WAVE_TIME = 26;

  const PATH = [[-20, 92], [310, 92], [310, 162], [50, 162], [50, 232], [336, 232]];
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

  // ---------- content ----------
  const TYPE_KEYS = ['archer', 'gunner', 'cannon', 'mage', 'sniper', 'miner'];
  const TYPES = {
    archer: {
      name: 'Strijelac', emoji: '🏹', cost: 10, dmg: 6, rate: 1, speed: 420, c1: '#4cc26a', c2: '#26803f',
      desc: 'Jeftin i pouzdan. Najbolji izbor za početak.', best: 'Početak igre, osnovna odbrana'
    },
    gunner: {
      name: 'Puškar', emoji: '🔫', cost: 25, dmg: 3, rate: 3, speed: 760, c1: '#5b8cff', c2: '#2c4fb8',
      desc: 'Veoma brza paljba sitnom štetom.', best: 'Brzi i slabi neprijatelji'
    },
    cannon: {
      name: 'Top', emoji: '💣', cost: 50, dmg: 16, rate: 0.5, speed: 250, splash: 48, c1: '#ff7a59', c2: '#b83c22',
      desc: 'Spora paljba, ali šteta po površini (60% okolo).', best: 'Grupe neprijatelja'
    },
    mage: {
      name: 'Čarobnjak', emoji: '🧙', cost: 40, dmg: 5, rate: 1.2, speed: 320, slow: 0.4, slowT: 2, c1: '#b57bff', c2: '#6a35c4',
      desc: 'Usporava metu za 40% na 2s. Pojačava sve ostale.', best: 'Podrška, brzi neprijatelji'
    },
    sniper: {
      name: 'Snajper', emoji: '🎯', cost: 70, dmg: 60, rate: 0.35, speed: 1400, target: 'strong', c1: '#ffd24a', c2: '#c48a12',
      desc: 'Ogromna šteta jednoj meti. Cilja najjačeg.', best: 'Tenkovi i bosovi'
    },
    miner: {
      name: 'Rudar', emoji: '⛏️', cost: 30, income: 0.35, c1: '#37c9c0', c2: '#1b857f',
      desc: 'Ne puca, nego proizvodi 🪙. Spajanjem raste.', best: 'Rano u igri (isplati se za ~90s)'
    }
  };

  const ENEMIES = {
    grunt: { name: 'Zombi', emoji: '🧟', hp: 1, spd: 1, rew: 1, dmg: 1 },
    runner: { name: 'Brzi', emoji: '🦇', hp: 0.55, spd: 1.8, rew: 1, dmg: 1 },
    tank: { name: 'Tenk', emoji: '🐗', hp: 3.2, spd: 0.65, rew: 2.5, dmg: 1 },
    boss: { name: 'BOSS', emoji: '👹', hp: 22, spd: 0.55, rew: 20, dmg: 3 }
  };

  const MODES = {
    easy: { key: 'easy', name: 'Lagano', emoji: '🌱', coins: 30, lives: 15, hp: 0.65, income: 1.3, reward: 1.15 },
    normal: { key: 'normal', name: 'Srednje', emoji: '⚔️', coins: 15, lives: 10, hp: 1, income: 1, reward: 1 },
    hard: { key: 'hard', name: 'Teško', emoji: '🔥', coins: 10, lives: 5, hp: 1.5, income: 0.8, reward: 0.9 }
  };
  const MODE_KEYS = ['easy', 'normal', 'hard'];

  // ---------- helpers ----------
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
  function shopRect(i) {
    const col = i % 3, row = Math.floor(i / 3);
    return { x: 12 + col * 114, y: SHOP_Y + row * (SHOP_BH + SHOP_GAP), w: 108, h: SHOP_BH };
  }

  function stats(type, tier) {
    const T = TYPES[type];
    if (T.income) return { income: T.income * Math.pow(ECO_MULT, tier - 1) };
    const dmg = T.dmg * Math.pow(ATK_MULT, tier - 1);
    return { dmg, rate: T.rate, dps: dmg * T.rate, slow: T.slow || 0, splash: T.splash || 0 };
  }

  function create(modeKey) {
    const m = MODES[modeKey] || MODES.normal;
    const s = {
      mode: m, coins: m.coins, lives: m.lives, wave: 0, waveTimer: 8,
      queue: [], nextQ: [], spawnCd: 0, enemies: [], slots: new Array(NSLOTS).fill(null),
      bought: { archer: 0, gunner: 0, cannon: 0, mage: 0, sniper: 0, miner: 0 },
      proj: [], texts: [], rings: [], sparks: [],
      announce: null, hurt: 0, over: false, time: 0, kills: 0, nextId: 1
    };
    s.nextQ = buildWave(1);
    return s;
  }

  function cost(s, type) {
    return Math.ceil(TYPES[type].cost * Math.pow(1.07, s.bought[type]));
  }
  function passiveIncome(s) { return (1.0 + 0.05 * s.wave) * s.mode.income; }
  function minerIncome(s) {
    let t = 0;
    for (const u of s.slots) if (u && u.type === 'miner') t += stats('miner', u.tier).income;
    return t * s.mode.income;
  }
  function income(s) { return passiveIncome(s) + minerIncome(s); }
  function earlyBonus(s) { return Math.max(0, Math.floor(s.waveTimer / 4)); }
  function isBossWave(w) { return w > 0 && w % 10 === 0; }
  function bossNext(s) { return isBossWave(s.wave + 1); }

  // ---------- player actions ----------
  function buy(s, type) {
    const c = cost(s, type);
    if (s.over) return -1;
    let slot = -1;
    for (let i = 0; i < NSLOTS; i++) if (!s.slots[i]) { slot = i; break; }
    if (slot < 0) return -2;
    if (s.coins < c) return -3;
    s.coins -= c;
    s.bought[type]++;
    s.slots[slot] = { type, tier: 1, cd: 0.4, val: c, flash: 0, aim: 0, acc: 0 };
    const p = slotPos(slot);
    s.rings.push({ x: p[0], y: p[1], t: 0, c: '#ffffff', r: 34, life: 0.35 });
    return slot;
  }

  function canMerge(s, a, b) {
    const A = s.slots[a], B = s.slots[b];
    return a !== b && !!A && !!B && A.type === B.type && A.tier === B.tier && A.tier < MAXTIER;
  }

  function move(s, a, b) {
    if (a === b || !s.slots[a]) return null;
    if (!s.slots[b]) { s.slots[b] = s.slots[a]; s.slots[a] = null; return 'move'; }
    if (canMerge(s, a, b)) {
      const B = s.slots[b];
      B.tier++; B.val += s.slots[a].val; B.cd = 0.3; B.flash = 0.2;
      s.slots[a] = null;
      const p = slotPos(b);
      s.rings.push({ x: p[0], y: p[1], t: 0, c: '#ffd84a', r: 44, life: 0.45 });
      s.texts.push({ x: p[0], y: p[1] - 20, t: 0, s: 'Nivo ' + B.tier + '!', c: '#ffd84a', size: 15, life: 0.9 });
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

  // ---------- waves ----------
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
    if (isBossWave(w)) q.push('boss');
    return q;
  }

  function previewCounts(s) {
    const c = {};
    for (const k of s.nextQ) c[k] = (c[k] || 0) + 1;
    return c;
  }

  function startWave(s) {
    s.wave++;
    s.queue = s.queue.concat(s.nextQ);
    s.nextQ = buildWave(s.wave + 1);
    s.waveTimer = WAVE_TIME;
    if (isBossWave(s.wave)) s.announce = { text: '👹 BOSS!', sub: 'Snajper najbolje gađa najjačeg', t: 0, life: 2.6, color: '#ff5a5a' };
    else if (bossNext(s)) s.announce = { text: '⚠️ BOSS ZA SLJEDEĆI TALAS', sub: 'Pripremi snajpere i jače vojnike', t: 0, life: 2.6, color: '#ffb347' };
  }

  function callWave(s) {
    if (s.over || s.waveTimer <= 3) return 0;
    const b = earlyBonus(s);
    s.coins += b;
    startWave(s);
    return b;
  }

  function hpFor(s, kind) {
    return 10 * Math.pow(1.17, s.wave - 1) * (1 + 0.05 * s.wave) * ENEMIES[kind].hp * s.mode.hp;
  }

  function spawn(s, kind) {
    const e = ENEMIES[kind];
    const hp = hpFor(s, kind);
    s.enemies.push({
      id: s.nextId++, kind, hp, max: hp, pend: 0, d: 0, x: PATH[0][0], y: PATH[0][1],
      spd: BASE_SPEED * e.spd, reward: e.rew * 1.3 * (1 + 0.12 * s.wave) * s.mode.reward, dmg: e.dmg,
      slowT: 0, slowF: 0, hit: 0
    });
  }

  // ---------- combat ----------
  function fmtReward(r) { return r >= 10 ? String(Math.round(r)) : String(Math.round(r * 10) / 10); }

  function hit(s, e, dmg, showNum) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hit = 0.09;
    if (showNum && s.texts.length < 50) {
      s.texts.push({ x: e.x + (Math.random() * 8 - 4), y: e.y - 14, t: 0, s: dmg >= 10 ? String(Math.round(dmg)) : dmg.toFixed(1), c: '#ffffff', size: 10, life: 0.5, small: true });
    }
    if (e.hp <= 0) {
      e.dead = true;
      s.coins += e.reward;
      s.kills++;
      s.texts.push({ x: e.x, y: e.y - 16, t: 0, s: '+' + fmtReward(e.reward) + ' 🪙', c: '#ffd84a', size: 13, life: 0.9 });
      s.sparks.push({ x: e.x, y: e.y, t: 0, c: '#ffd84a', life: 0.3, big: true });
    }
  }

  function applySlow(e, f, t) {
    const k = e.kind === 'boss' ? 0.5 : 1;
    e.slowF = Math.max(e.slowF * (e.slowT > 0 ? 1 : 0), f * k);
    e.slowT = Math.max(e.slowT, t);
  }

  function impact(s, p) {
    const e = p.target;
    if (e) e.pend = Math.max(0, e.pend - p.dmg);
    if (p.splash) {
      for (const o of s.enemies) {
        if (o.dead) continue;
        if (Math.hypot(o.x - p.tx, o.y - p.ty) <= p.splash) hit(s, o, o === e ? p.dmg : p.dmg * 0.6, o === e);
      }
      s.rings.push({ x: p.tx, y: p.ty, t: 0, c: '#ff9a4a', r: p.splash, life: 0.3, fill: true });
    } else if (e && !e.dead) {
      hit(s, e, p.dmg, true);
      if (p.slow) applySlow(e, p.slow, p.slowT);
      s.sparks.push({ x: e.x, y: e.y, t: 0, c: p.type === 'mage' ? '#c9a2ff' : '#ffffff', life: 0.16 });
    }
  }

  function pickTarget(s, T) {
    let best = null, bs = -1;
    for (const e of s.enemies) {
      if (e.dead || e.hp - e.pend <= 0.0001) continue;
      const score = T.target === 'strong' ? e.hp * 1000 + e.d : e.d;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }

  function update(s, dt) {
    if (s.over) return;
    s.time += dt;
    s.coins += income(s) * dt;

    // miners: visual production meter + pops
    for (let i = 0; i < NSLOTS; i++) {
      const u = s.slots[i];
      if (!u || u.type !== 'miner') continue;
      const inc = stats('miner', u.tier).income * s.mode.income;
      u.acc = (u.acc || 0) + inc * dt;
      if (u.acc >= 1) {
        const n = Math.floor(u.acc);
        u.acc -= n;
        const p = slotPos(i);
        s.texts.push({ x: p[0], y: p[1] - 24, t: 0, s: '+' + n + ' 🪙', c: '#7ff0e6', size: 13, life: 0.9 });
        u.flash = 0.18;
      }
      if (u.flash > 0) u.flash -= dt;
    }

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
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowF = 0; }
      if (e.hit > 0) e.hit -= dt;
      e.d += e.spd * (1 - e.slowF) * dt;
      const p = posAt(e.d);
      e.x = p[0]; e.y = p[1];
      if (e.d >= LEN && !e.dead) {
        e.dead = true; e.leaked = true;
        s.lives -= e.dmg;
        s.hurt = 0.4;
        s.texts.push({ x: 322, y: e.y - 18, t: 0, s: '-' + e.dmg + ' ❤️', c: '#ff7b7b', size: 15, life: 0.9 });
      }
    }

    // towers
    for (let i = 0; i < NSLOTS; i++) {
      const u = s.slots[i];
      if (!u || u.type === 'miner') continue;
      if (u.flash > 0) u.flash -= dt;
      u.cd -= dt;
      if (u.cd > 0) continue;
      const T = TYPES[u.type];
      const target = pickTarget(s, T);
      if (!target) { u.cd = 0; continue; }
      const st = stats(u.type, u.tier);
      const sp = slotPos(i);
      target.pend += st.dmg;
      s.proj.push({
        x: sp[0], y: sp[1], sx: sp[0], sy: sp[1], tx: target.x, ty: target.y, target,
        dmg: st.dmg, type: u.type, speed: T.speed, splash: T.splash || 0, slow: T.slow || 0, slowT: T.slowT || 0,
        total: Math.hypot(target.x - sp[0], target.y - sp[1]), trav: 0
      });
      u.flash = 0.14;
      u.aim = Math.atan2(target.y - sp[1], target.x - sp[0]);
      u.cd += 1 / st.rate;
      if (u.cd < -0.2) u.cd = 0;
    }

    // projectiles (they fly and hit; no instant damage)
    for (const p of s.proj) {
      if (p.target && !p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step + 3) {
        p.done = true;
        if (p.splash || (p.target && !p.target.dead)) impact(s, p);
        else if (p.target) p.target.pend = Math.max(0, p.target.pend - p.dmg);
      } else {
        p.x += dx / d * step; p.y += dy / d * step; p.trav += step;
      }
    }
    s.proj = s.proj.filter(p => !p.done);
    s.enemies = s.enemies.filter(e => !e.dead);

    // fx
    for (const a of s.texts) a.t += dt;
    for (const a of s.rings) a.t += dt;
    for (const a of s.sparks) a.t += dt;
    s.texts = s.texts.filter(a => a.t < a.life);
    s.rings = s.rings.filter(a => a.t < a.life);
    s.sparks = s.sparks.filter(a => a.t < a.life);
    if (s.announce) { s.announce.t += dt; if (s.announce.t > s.announce.life) s.announce = null; }
    if (s.hurt > 0) s.hurt -= dt;

    if (s.lives <= 0) { s.lives = 0; s.over = true; }
  }

  // ---------- advice: what to add / do next ----------
  function advise(s) {
    for (let i = 0; i < NSLOTS; i++)
      for (let j = i + 1; j < NSLOTS; j++)
        if (canMerge(s, i, j)) {
          const u = s.slots[i];
          return { kind: 'merge', a: i, b: j, text: 'Spoji 2× ' + TYPES[u.type].name + ' (nivo ' + u.tier + ') u nivo ' + (u.tier + 1) + ' — jači je od dva odvojena.' };
        }
    let empty = 0;
    const counts = { archer: 0, gunner: 0, cannon: 0, mage: 0, sniper: 0, miner: 0 };
    for (const u of s.slots) { if (!u) empty++; else counts[u.type]++; }
    if (empty === 0) return { kind: 'full', text: 'Nema mjesta! Prodaj najslabijeg (povuci dolje) ili spoji ostale.' };

    const attackers = counts.archer + counts.gunner + counts.cannon + counts.mage + counts.sniper;
    let want = null, why = '';
    let nRun = 0, nTank = 0;
    for (const e of s.enemies) { if (e.kind === 'runner') nRun++; else if (e.kind === 'tank') nTank++; }

    if (bossNext(s) && counts.sniper === 0 && s.wave >= 3) { want = 'sniper'; why = 'Boss stiže — Snajper gađa najjačeg i radi ogromnu štetu.'; }
    else if (counts.miner === 0 && s.wave < 10) { want = 'miner'; why = 'Rudar proizvodi 🪙 — što ranije kupiš, više zaradi.'; }
    else if (counts.miner < 2 && s.wave < 6 && attackers >= 3) { want = 'miner'; why = 'Drugi Rudar ubrzava ekonomiju dok je rano.'; }
    else if (s.enemies.length >= 6 && counts.cannon < 2) { want = 'cannon'; why = 'Puno neprijatelja na putu — Top pogađa više njih odjednom.'; }
    else if (nRun >= 3 && counts.mage === 0) { want = 'mage'; why = 'Brzi neprijatelji — Čarobnjak ih usporava za 40%.'; }
    else if (nTank >= 2 && counts.sniper < 1) { want = 'sniper'; why = 'Tenkovi su debeli — Snajper ih najbolje probija.'; }
    else {
      let bv = -1;
      const bonus = { archer: 1, gunner: 1, cannon: 1.8, mage: 1.5, sniper: 1.1 };
      for (const k of ['archer', 'gunner', 'cannon', 'mage', 'sniper']) {
        const T = TYPES[k];
        const v = (T.dmg * T.rate * bonus[k]) / cost(s, k) / (1 + 0.4 * counts[k]);
        if (v > bv) { bv = v; want = k; }
      }
      const T = TYPES[want];
      why = 'Najisplativije sada: ' + T.name + ' (DPS ' + fmt(T.dmg * T.rate) + ' za ' + cost(s, want) + ' 🪙).';
    }
    const c = cost(s, want);
    if (s.coins < c) why += ' Fali još ' + Math.ceil(c - s.coins) + ' 🪙.';
    return { kind: 'buy', type: want, text: why };
  }

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(0) + 'k';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    if (n >= 100) return String(Math.round(n));
    return (Math.round(n * 10) / 10).toString();
  }

  // ---------- simple bot (balance testing / demo) ----------
  function bot(s) {
    for (let i = 0; i < NSLOTS; i++)
      for (let j = i + 1; j < NSLOTS; j++)
        if (canMerge(s, i, j)) { move(s, i, j); return; }
    const counts = { archer: 0, gunner: 0, cannon: 0, mage: 0, sniper: 0, miner: 0 };
    for (const u of s.slots) if (u) counts[u.type]++;
    let pick;
    const atk = counts.archer + counts.gunner + counts.cannon + counts.mage + counts.sniper;
    if (atk >= 2 && counts.miner < 2 && s.wave < 8) pick = 'miner';
    else {
      pick = 'archer';
      const pool = ['archer', 'gunner', 'cannon', 'mage'];
      if (s.wave >= 5) pool.push('sniper');
      for (const k of pool) if (counts[k] < counts[pick]) pick = k;
    }
    if (s.coins >= cost(s, pick)) buy(s, pick);
  }

  const Core = {
    W, H, COLS, ROWS, NSLOTS, CELL, PITCH, GRID_X, GRID_Y, PANEL_Y, PANEL_H, SHOP_Y, SHOP_BH, MAXTIER, LEN, PATH,
    TYPES, TYPE_KEYS, ENEMIES, MODES, MODE_KEYS,
    posAt, slotPos, slotAt, shopRect, stats, create, cost, income, passiveIncome, minerIncome, earlyBonus,
    isBossWave, bossNext, previewCounts, buy, canMerge, move, sell, callWave, update, advise, fmt, bot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(this);
