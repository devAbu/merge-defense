// Merge Defense v2 - game logic (no DOM, testable in Node)
(function (root) {
  'use strict';

  // ---------- layout / constants ----------
  const W = 360, H = 740;
  const COLS = 5, ROWS = 3, NSLOTS = COLS * ROWS;
  const CELL = 64, PITCH = 68;
  const GRID_X = 12, GRID_Y = 308;
  const PANEL_Y = 516, PANEL_H = 52;
  const SHOP_Y = 572, SHOP_BH = 50, SHOP_GAP = 5;
  const MAXTIER = 8;
  const ATK_MULT = 2.4;     // damage multiplier per tier
  const ECO_MULT = 2.2;     // miner income multiplier per tier
  const BASE_SPEED = 42;
  const WAVE_TIME = 26;
  const AUTO_TIME = 60, AUTO_CD = 15, AUTO_TICK = 0.4;
  const DBL_TIME = 60, DBL_CD = 15;

  // ---------- maps ----------
  // Each map is a polyline the enemies walk along (field is x -20..340, y ~90..235). Lengths are kept similar
  // (~1000-1060) so difficulty stays comparable; verify with `npm run sim`.
  const MAPS = {
    classic: { name: 'Classic', emoji: '🛣️', path: [[-20, 92], [310, 92], [310, 162], [50, 162], [50, 232], [336, 232]] },
    zigzag: { name: 'Zigzag', emoji: '⚡', path: [[-20, 92], [40, 92], [40, 232], [100, 232], [100, 92], [160, 92], [160, 232], [220, 232], [220, 92], [280, 92], [280, 232], [336, 232]] },
    spiral: { name: 'Spiral', emoji: '🌀', path: [[-20, 92], [320, 92], [320, 232], [40, 232], [40, 162], [250, 162]] }
  };
  const MAP_KEYS = ['classic', 'zigzag', 'spiral'];
  function buildGeo(path) {
    const seg = [];
    let len = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const [x1, y1] = path[i], [x2, y2] = path[i + 1];
      const l = Math.hypot(x2 - x1, y2 - y1);
      seg.push({ x1, y1, x2, y2, l, s: len });
      len += l;
    }
    return {
      PATH: path, SEG: seg, LEN: len,
      posAt: function (d) {
        for (const g of seg) {
          if (d <= g.s + g.l) {
            const t = Math.max(0, (d - g.s) / g.l);
            return [g.x1 + (g.x2 - g.x1) * t, g.y1 + (g.y2 - g.y1) * t];
          }
        }
        const last = path[path.length - 1];
        return [last[0], last[1]];
      }
    };
  }
  for (const k of MAP_KEYS) MAPS[k].geo = buildGeo(MAPS[k].path);
  const PATH = MAPS.classic.geo.PATH, LEN = MAPS.classic.geo.LEN, posAt = MAPS.classic.geo.posAt; // classic, kept for old callers

  // ---------- content ----------
  const TYPE_KEYS = ['archer', 'gunner', 'cannon', 'mage', 'sniper', 'flame', 'tesla', 'banner', 'miner'];
  const TYPES = {
    archer: {
      name: 'Archer', emoji: '🏹', cost: 10, dmg: 6, rate: 1, speed: 420, c1: '#4cc26a', c2: '#26803f',
      desc: 'Cheap and reliable. Best pick to start.', best: 'Early game, basic defense'
    },
    gunner: {
      name: 'Gunner', emoji: '🔫', cost: 25, dmg: 3, rate: 3, speed: 760, c1: '#5b8cff', c2: '#2c4fb8',
      desc: 'Very fast fire, tiny damage.', best: 'Fast, weak enemies'
    },
    cannon: {
      name: 'Cannon', emoji: '💣', cost: 50, dmg: 16, rate: 0.5, speed: 250, splash: 48, c1: '#ff7a59', c2: '#b83c22',
      desc: 'Slow fire, area damage (60% around).', best: 'Groups of enemies'
    },
    mage: {
      name: 'Mage', emoji: '🧙', cost: 40, dmg: 5, rate: 1.2, speed: 320, slow: 0.4, slowT: 2, c1: '#b57bff', c2: '#6a35c4',
      desc: 'Slows the target 40% for 2s. Helps the rest.', best: 'Support, fast enemies'
    },
    sniper: {
      name: 'Sniper', emoji: '🎯', cost: 70, dmg: 60, rate: 0.35, speed: 1400, target: 'strong', c1: '#ffd24a', c2: '#c48a12',
      desc: 'Huge damage to one target. Aims at the strongest.', best: 'Tanks and bosses'
    },
    flame: {
      name: 'Pyro', emoji: '🔥', cost: 45, dmg: 5, rate: 1.5, speed: 520, burn: 0.7, burnT: 3, c1: '#ff5f6d', c2: '#b0172a',
      desc: 'Burns the target 3s (70% dmg/s), ignores armor.', best: 'Tanks and bosses'
    },
    tesla: {
      name: 'Tesla', emoji: '⚡', cost: 60, dmg: 8, rate: 1, speed: 900, chain: 2, chainR: 90, chainF: 0.5, c1: '#22d3ee', c2: '#0e7490',
      desc: 'Lightning jumps to 2 more nearby enemies.', best: 'Groups of enemies'
    },
    banner: {
      name: 'Banner', emoji: '🚩', cost: 55, aura: 0.12, auraStep: 0.03, c1: '#f472b6', c2: '#9d174d',
      desc: 'Does not shoot. Boosts neighbours (+12% damage).', best: 'Next to several strong units'
    },
    miner: {
      name: 'Miner', emoji: '⛏️', cost: 30, income: 0.35, c1: '#37c9c0', c2: '#1b857f',
      desc: 'Does not shoot, produces 🪙. Grows by merging.', best: 'Early game (pays off in ~90s)'
    }
  };

  const ENEMIES = {
    grunt: { name: 'Zombie', emoji: '🧟', hp: 1, spd: 1, rew: 1, dmg: 1 },
    runner: { name: 'Runner', emoji: '🦇', hp: 0.55, spd: 1.8, rew: 1, dmg: 1 },
    tank: { name: 'Tank', emoji: '🐗', hp: 3.2, spd: 0.65, rew: 2.5, dmg: 1 },
    boss: { name: 'BOSS', emoji: '👹', hp: 22, spd: 0.55, rew: 20, dmg: 3 }
  };
  // Boss variety: every 10th wave a different boss with its own mechanic
  const BOSSES = [
    { key: 'golem', name: 'Golem', emoji: '🗿', hp: 22, spd: 0.5, rew: 20, armor: 0.72, info: 'Stone skin: takes 28% less damage.' },
    { key: 'drake', name: 'Dragon', emoji: '🐉', hp: 15, spd: 1.05, rew: 24, info: 'Fast and dangerous — hits hard right away.' },
    { key: 'guard', name: 'Guardian', emoji: '🧙‍♂️', hp: 21, spd: 0.55, rew: 22, regen: 0.025, info: 'Heals 2.5% of its health per second.' },
    { key: 'necro', name: 'Necromancer', emoji: '💀', hp: 18, spd: 0.55, rew: 24, summon: 3.5, info: 'Summons zombies as it walks.' }
  ];
  function bossVariant(w) { return Math.floor(w / 10 - 1) % BOSSES.length; }

  const MODES = {
    easy: { key: 'easy', name: 'Easy', emoji: '🌱', coins: 30, lives: 15, hp: 0.65, income: 1.3, reward: 1.15 },
    normal: { key: 'normal', name: 'Normal', emoji: '⚔️', coins: 15, lives: 10, hp: 1, income: 1, reward: 1 },
    hard: { key: 'hard', name: 'Hard', emoji: '🔥', coins: 10, lives: 5, hp: 1.5, income: 0.8, reward: 0.9 }
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
    if (T.aura) return { aura: T.aura + (T.auraStep || 0) * (tier - 1), dmg: 0, rate: 0, dps: 0, slow: 0, splash: 0 };
    const dmg = T.dmg * Math.pow(ATK_MULT, tier - 1);
    return { dmg, rate: T.rate, dps: dmg * T.rate, slow: T.slow || 0, splash: T.splash || 0 };
  }

  // Support units (banner) boost the damage of their 4 orthogonal neighbours on the board.
  function neighbours(i) {
    const c = i % COLS;
    const nb = [];
    if (c > 0) nb.push(i - 1);
    if (c < COLS - 1) nb.push(i + 1);
    if (i >= COLS) nb.push(i - COLS);
    if (i + COLS < NSLOTS) nb.push(i + COLS);
    return nb;
  }
  function auraAt(s, i) {
    let a = 0;
    for (const j of neighbours(i)) {
      const u = s.slots[j];
      if (u && TYPES[u.type].aura) a += stats(u.type, u.tier).aura;
    }
    return Math.min(a, 1);
  }
  function zeroCounts() { const o = {}; for (const k of TYPE_KEYS) o[k] = 0; return o; }

  function ev(s, k, x) {
    if (s.events.length < 200) s.events.push(x ? Object.assign({ k }, x) : { k });
  }

  function create(modeKey, meta, mapKey) {
    const m = MODES[modeKey] || MODES.normal;
    meta = meta || {};
    if (!MAPS[mapKey]) mapKey = 'classic';
    const s = {
      mode: m, mapKey, geo: MAPS[mapKey].geo, coins: m.coins + (meta.coins || 0), lives: m.lives + (meta.lives || 0),
      incMul: meta.inc || 1, dmgMul: meta.dmg || 1, revived: false, bossKills: 0, dblT: 0, dblCd: 0, wave: 0, waveTimer: 8,
      queue: [], nextQ: [], spawnCd: 0, enemies: [], slots: new Array(NSLOTS).fill(null),
      bought: zeroCounts(),
      proj: [], texts: [], rings: [], sparks: [], arcs: [],
      announce: null, hurt: 0, over: false, time: 0, kills: 0, nextId: 1,
      events: [], autoT: 0, autoCd: 0, autoTick: 0
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
  function mult(s) { return s.incMul * (s.dblT > 0 ? 2 : 1); }
  function income(s) { return (passiveIncome(s) + minerIncome(s)) * mult(s); }
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
    ev(s, 'buy');
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
      s.texts.push({ x: p[0], y: p[1] - 20, t: 0, s: 'Level ' + B.tier + '!', c: '#ffd84a', size: 15, life: 0.9 });
      ev(s, 'merge', { tier: B.tier });
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
    ev(s, 'sell');
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
    ev(s, 'wave');
    if (isBossWave(s.wave)) ev(s, 'boss'); else if (bossNext(s)) ev(s, 'bossWarn');
    if (isBossWave(s.wave)) s.announce = { text: BOSSES[bossVariant(s.wave)].emoji + ' BOSS: ' + BOSSES[bossVariant(s.wave)].name + '!', sub: BOSSES[bossVariant(s.wave)].info, t: 0, life: 2.6, color: '#ff5a5a' };
    else if (bossNext(s)) s.announce = { text: '⚠️ BOSS NEXT WAVE', sub: BOSSES[bossVariant(s.wave + 1)].emoji + ' ' + BOSSES[bossVariant(s.wave + 1)].name + ': ' + BOSSES[bossVariant(s.wave + 1)].info, t: 0, life: 2.6, color: '#ffb347' };
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
    let e = ENEMIES[kind];
    let bv = null;
    if (kind === 'boss') { bv = BOSSES[bossVariant(s.wave)]; e = Object.assign({}, e, { hp: bv.hp, spd: bv.spd, rew: bv.rew }); }
    const hp = hpFor(s, kind) * (bv ? bv.hp / ENEMIES.boss.hp : 1);
    if (kind === 'boss') ev(s, 'bossSpawn');
    const en = {
      id: s.nextId++, kind, hp, max: hp, pend: 0, d: 0, x: s.geo.PATH[0][0], y: s.geo.PATH[0][1],
      spd: BASE_SPEED * e.spd, reward: e.rew * 1.3 * (1 + 0.12 * s.wave) * s.mode.reward, dmg: e.dmg,
      slowT: 0, slowF: 0, hit: 0, burnT: 0, burnDps: 0
    };
    if (bv) {
      en.variant = bossVariant(s.wave); en.emoji = bv.emoji; en.bname = bv.name;
      en.armor = bv.armor || 0; en.regen = bv.regen || 0; en.summon = bv.summon || 0; en.sumT = bv.summon || 0;
    }
    s.enemies.push(en);
    return en;
  }

  // ---------- combat ----------
  function fmtReward(r) { return r >= 10 ? String(Math.round(r)) : String(Math.round(r * 10) / 10); }

  function hit(s, e, dmg, showNum, dot) {
    if (e.dead) return;
    if (!dot) { // burning ("dot") ignores armor and does not flash
      if (e.armor) dmg *= e.armor;
      e.hit = 0.09;
    }
    e.hp -= dmg;
    if (showNum && s.texts.length < 50) {
      s.texts.push({ x: e.x + (Math.random() * 8 - 4), y: e.y - 14, t: 0, s: dmg >= 10 ? String(Math.round(dmg)) : dmg.toFixed(1), c: '#ffffff', size: 10, life: 0.5, small: true });
    }
    if (e.hp <= 0) {
      e.dead = true;
      const rw = e.reward * mult(s);
      s.coins += rw;
      s.kills++;
      s.texts.push({ x: e.x, y: e.y - 16, t: 0, s: '+' + fmtReward(rw) + ' 🪙', c: '#ffd84a', size: 13, life: 0.9 });
      s.sparks.push({ x: e.x, y: e.y, t: 0, c: '#ffd84a', life: 0.3, big: true });
      ev(s, 'kill', { boss: e.kind === 'boss' });
      if (e.kind === 'boss') { s.bossKills++; ev(s, 'bossKill', { variant: e.variant, wave: s.wave }); }
    }
  }

  function applySlow(e, f, t) {
    const k = e.kind === 'boss' ? 0.5 : 1;
    e.slowF = Math.max(e.slowF * (e.slowT > 0 ? 1 : 0), f * k);
    e.slowT = Math.max(e.slowT, t);
  }

  // Lightning: from the hit enemy jump to the nearest other enemies, each jump deals a fraction of the damage.
  function chainHit(s, from, p) {
    const used = [from];
    let cur = from;
    for (let n = 0; n < p.chain; n++) {
      let best = null, bd = p.chainR;
      for (const o of s.enemies) {
        if (o.dead || used.indexOf(o) >= 0) continue;
        const d = Math.hypot(o.x - cur.x, o.y - cur.y);
        if (d <= bd) { bd = d; best = o; }
      }
      if (!best) break;
      hit(s, best, p.dmg * p.chainF, false);
      if (s.arcs.length < 40) s.arcs.push({ x1: cur.x, y1: cur.y, x2: best.x, y2: best.y, t: 0, life: 0.16 });
      s.sparks.push({ x: best.x, y: best.y, t: 0, c: '#7ee7ff', life: 0.16 });
      used.push(best); cur = best;
    }
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
      if (p.burn && !e.dead) { e.burnT = Math.max(e.burnT || 0, p.burnT); e.burnDps = Math.max(e.burnDps || 0, p.burn); }
      if (p.chain) chainHit(s, e, p);
      s.sparks.push({ x: e.x, y: e.y, t: 0, c: p.type === 'mage' ? '#c9a2ff' : p.type === 'flame' ? '#ff9a4a' : p.type === 'tesla' ? '#7ee7ff' : '#ffffff', life: 0.16 });
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
        ev(s, 'coin');
      }
      if (u.flash > 0) u.flash -= dt;
    }

    // double-income power-up (rewarded-ad feature)
    if (s.dblT > 0) {
      s.dblT -= dt;
      if (s.dblT <= 0) { s.dblT = 0; s.dblCd = DBL_CD; }
    } else if (s.dblCd > 0) {
      s.dblCd = Math.max(0, s.dblCd - dt);
    }

    // auto-merge power-up (rewarded-ad feature): merges pairs by itself while active
    if (s.autoT > 0) {
      s.autoT -= dt;
      s.autoTick -= dt;
      if (s.autoTick <= 0) { s.autoTick = AUTO_TICK; autoMergeStep(s); }
      if (s.autoT <= 0) { s.autoT = 0; s.autoCd = AUTO_CD; }
    } else if (s.autoCd > 0) {
      s.autoCd = Math.max(0, s.autoCd - dt);
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
    const spawns = [];
    for (const e of s.enemies) {
      if (e.regen && !e.dead) e.hp = Math.min(e.max, e.hp + e.max * e.regen * dt);
      if (e.summon && !e.dead) {
        e.sumT -= dt;
        if (e.sumT <= 0) { e.sumT = e.summon; if (s.enemies.length < 45) spawns.push(e); }
      }
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowF = 0; }
      if (e.burnT > 0 && !e.dead) {
        const bd = Math.min(dt, e.burnT);
        e.burnT -= dt;
        hit(s, e, e.burnDps * bd, false, true);
        if (e.burnT <= 0) { e.burnT = 0; e.burnDps = 0; }
      }
      if (e.hit > 0) e.hit -= dt;
      e.d += e.spd * (1 - e.slowF) * dt;
      const p = s.geo.posAt(e.d);
      e.x = p[0]; e.y = p[1];
      if (e.d >= s.geo.LEN && !e.dead) {
        e.dead = true; e.leaked = true;
        s.lives -= e.dmg;
        s.hurt = 0.4;
        ev(s, 'leak');
        s.texts.push({ x: Math.min(322, s.geo.PATH[s.geo.PATH.length - 1][0]), y: e.y - 18, t: 0, s: '-' + e.dmg + ' ❤️', c: '#ff7b7b', size: 15, life: 0.9 });
      }
    }
    for (const b of spawns) {
      const m = spawn(s, 'grunt');
      m.hp = m.max = m.max * 0.6; m.reward *= 0.5;
      m.d = Math.max(0, b.d - 14);
      const q = s.geo.posAt(m.d); m.x = q[0]; m.y = q[1];
    }

    // towers
    for (let i = 0; i < NSLOTS; i++) {
      const u = s.slots[i];
      if (!u || u.type === 'miner') continue;
      if (u.flash > 0) u.flash -= dt;
      if (TYPES[u.type].aura) continue; // support units do not shoot
      u.cd -= dt;
      if (u.cd > 0) continue;
      const T = TYPES[u.type];
      const target = pickTarget(s, T);
      if (!target) { u.cd = 0; continue; }
      const st = stats(u.type, u.tier);
      const sp = slotPos(i);
      const dmgNow = st.dmg * s.dmgMul * (1 + auraAt(s, i));
      target.pend += st.dmg;
      s.proj.push({
        x: sp[0], y: sp[1], sx: sp[0], sy: sp[1], tx: target.x, ty: target.y, target,
        dmg: dmgNow, type: u.type, speed: T.speed, splash: T.splash || 0, slow: T.slow || 0, slowT: T.slowT || 0,
        burn: T.burn ? dmgNow * T.burn : 0, burnT: T.burnT || 0, chain: T.chain || 0, chainR: T.chainR || 0, chainF: T.chainF || 0,
        total: Math.hypot(target.x - sp[0], target.y - sp[1]), trav: 0
      });
      u.flash = 0.14;
      u.aim = Math.atan2(target.y - sp[1], target.x - sp[0]);
      ev(s, 'shot', { type: u.type });
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
    for (const a of s.arcs) a.t += dt;
    s.texts = s.texts.filter(a => a.t < a.life);
    s.rings = s.rings.filter(a => a.t < a.life);
    s.sparks = s.sparks.filter(a => a.t < a.life);
    s.arcs = s.arcs.filter(a => a.t < a.life);
    if (s.announce) { s.announce.t += dt; if (s.announce.t > s.announce.life) s.announce = null; }
    if (s.hurt > 0) s.hurt -= dt;

    if (s.lives <= 0) { s.lives = 0; s.over = true; ev(s, 'over'); }
  }

  // ---------- auto-merge ----------
  function autoMergeStep(s) {
    let bi = -1, bj = -1, bt = 99;
    for (let i = 0; i < NSLOTS; i++)
      for (let j = i + 1; j < NSLOTS; j++)
        if (canMerge(s, i, j) && s.slots[i].tier < bt) { bt = s.slots[i].tier; bi = i; bj = j; }
    if (bi < 0) return false;
    move(s, bi, bj);
    return true;
  }
  function activateAuto(s) {
    if (s.over || s.autoT > 0 || s.autoCd > 0) return false;
    s.autoT = AUTO_TIME; s.autoTick = 0.2;
    ev(s, 'auto');
    return true;
  }
  function activateDouble(s) {
    if (s.over || s.dblT > 0 || s.dblCd > 0) return false;
    s.dblT = DBL_TIME; ev(s, 'auto');
    return true;
  }
  function dblInfo(s) {
    if (s.dblT > 0) return { state: 'active', left: s.dblT, frac: s.dblT / DBL_TIME };
    if (s.dblCd > 0) return { state: 'cooldown', left: s.dblCd, frac: s.dblCd / DBL_CD };
    return { state: 'ready', left: 0, frac: 1 };
  }
  // Rewarded "continue": +3 lives, clears the path
  function revive(s) {
    if (!s.over || s.revived) return false;
    s.revived = true; s.over = false; s.lives = 3;
    s.enemies = []; s.proj = []; s.queue = [];
    s.waveTimer = Math.max(s.waveTimer, 14);
    s.announce = { text: '💖 Back in the fight!', sub: '+3 lives, the path is cleared', t: 0, life: 2.2, color: '#ff8fb1' };
    ev(s, 'auto');
    return true;
  }
  // { state: 'ready'|'active'|'cooldown', left: seconds, frac: 0..1 }
  function autoInfo(s) {
    if (s.autoT > 0) return { state: 'active', left: s.autoT, frac: s.autoT / AUTO_TIME };
    if (s.autoCd > 0) return { state: 'cooldown', left: s.autoCd, frac: s.autoCd / AUTO_CD };
    return { state: 'ready', left: 0, frac: 1 };
  }

  // ---------- advice: what to buy / what to sell ----------
  const BONUS = { archer: 1, gunner: 1, cannon: 1.5, mage: 1.3, sniper: 1.1, flame: 1.35, tesla: 1.4 };
  const ATTACKERS = ['archer', 'gunner', 'cannon', 'mage', 'sniper', 'flame', 'tesla'];

  function boardInfo(s, skip) {
    const counts = zeroCounts(), t1 = zeroCounts(), t2 = zeroCounts();
    let free = 0;
    for (let i = 0; i < NSLOTS; i++) {
      const u = s.slots[i];
      if (!u || i === skip) { free++; continue; }
      counts[u.type]++;
      if (u.tier === 1) t1[u.type]++;
      if (u.tier === 2) t2[u.type]++;
    }
    return { counts, t1, t2, free };
  }

  // Best thing to buy, given free slots, existing levels and merge chances.
  function bestBuy(s, b, free) {
    let nE = 0, nRun = 0, nTank = 0;
    for (const e of s.enemies) { nE++; if (e.kind === 'runner') nRun++; else if (e.kind === 'tank') nTank++; }
    const attackers = ATTACKERS.reduce((a, k) => a + b.counts[k], 0);
    let best = null;
    for (const k of TYPE_KEYS) {
      const T = TYPES[k];
      const c = cost(s, k);
      let v, why = '';
      if (k === 'miner') {
        const tf = Math.max(0.15, 1 - s.wave / 14);
        const cnt = b.counts.miner;
        v = 0.5 * tf * (cnt === 0 ? 2.2 : cnt === 1 ? 1.4 : cnt < 4 ? 0.8 : 0.3);
        if (attackers < 2) v *= 0.2;
        why = 'Miners produce 🪙 — the earlier, the more they earn.';
      } else if (T.aura) {
        let totalDps = 0;
        for (const u of s.slots) if (u && ATTACKERS.indexOf(u.type) >= 0) totalDps += stats(u.type, u.tier).dps;
        const avg = attackers ? totalDps / attackers : 0;
        v = (stats(k, 1).aura * Math.min(3, attackers) * avg * 1.2) / c / (1 + 0.9 * b.counts[k]);
        if (attackers < 3) v *= 0.15;
        why = 'Banner boosts neighbouring units by +' + Math.round(stats(k, 1).aura * 100) + '% damage.';
      } else {
        v = (T.dmg * T.rate * BONUS[k]) / c / (1 + 0.4 * b.counts[k]);
        why = 'Best value now: ' + T.name + ' (DPS ' + fmt(T.dmg * T.rate) + ' for ' + c + ' 🪙).';
        if (k === 'sniper' && bossNext(s) && b.counts.sniper === 0 && s.wave >= 3) { v *= 3; why = 'Boss incoming — the Sniper targets the strongest and deals huge damage.'; }
        else if (k === 'sniper' && nTank >= 2 && b.counts.sniper < 1) { v *= 1.6; why = 'Tanks are tough — the Sniper punches through best.'; }
        if (k === 'cannon' && nE >= 6 && b.counts.cannon < 2) { v *= 1.4; why = 'Lots of enemies on the path — the Cannon hits many at once.'; }
        if (k === 'mage' && nRun >= 3 && b.counts.mage === 0) { v *= 1.8; why = 'Fast enemies — the Mage slows them by 40%.'; }
        if (k === 'flame' && (nTank >= 2 || bossNext(s)) && b.counts.flame < 2) { v *= 1.5; why = 'Tough enemies — the Pyro burns targets and ignores armor.'; }
        if (k === 'tesla' && nE >= 5 && b.counts.tesla < 2) { v *= 1.4; why = 'Crowded path — Tesla jumps to 2 more enemies.'; }
      }
      // Merge chance: an unpaired level-1 unit of the same type exists, so buying one more merges at once
      const merges = b.t1[k] >= 1;
      if (merges) {
        v *= 1.7;
        if (b.t2[k] >= 1) v *= 1.15;
        why = 'Buy ' + T.name + ' — it merges with your ' + T.name + ' (level 1) into level 2 and takes no new slot.';
      } else if (free <= 1) v *= 0.45;
      else if (free === 2) v *= 0.65;
      else if (free === 3) v *= 0.85;
      if (!best || v > best.v) best = { type: k, v, why, merges, cost: c };
    }
    return best;
  }

  // How valuable a unit is to keep (higher = keep). Used to pick what to sell.
  function unitWorth(s, u, counts, idx) {
    let w;
    if (TYPES[u.type].aura) {
      // worth = extra damage it gives to its neighbours
      w = 0;
      const a = stats(u.type, u.tier).aura;
      for (const j of neighbours(idx)) {
        const o = s.slots[j];
        if (o && ATTACKERS.indexOf(o.type) >= 0) w += stats(o.type, o.tier).dps * BONUS[o.type] * a;
      }
    } else if (u.type === 'miner') {
      w = stats('miner', u.tier).income * s.mode.income * 25 * (s.wave < 12 ? 1.5 : s.wave < 20 ? 1 : 0.6);
    } else {
      w = stats(u.type, u.tier).dps * BONUS[u.type];
      if (u.type === 'sniper' && bossNext(s)) w *= 2;
    }
    if (counts[u.type] === 1) w *= 1.35; // last of its kind keeps variety
    return w;
  }

  function advise(s) {
    for (let i = 0; i < NSLOTS; i++)
      for (let j = i + 1; j < NSLOTS; j++)
        if (canMerge(s, i, j)) {
          const u = s.slots[i];
          return { kind: 'merge', a: i, b: j, text: 'Merge 2× ' + TYPES[u.type].name + ' (level ' + u.tier + ') into level ' + (u.tier + 1) + ' — stronger than two separate ones, and it frees a slot.' };
        }
    const b = boardInfo(s, -1);

    if (b.free === 0) {
      // Board full and nothing to merge: say exactly which unit to sell and what to buy after
      let wi = -1, ww = Infinity;
      for (let i = 0; i < NSLOTS; i++) {
        const w = unitWorth(s, s.slots[i], b.counts, i);
        if (w < ww) { ww = w; wi = i; }
      }
      const u = s.slots[wi];
      const T = TYPES[u.type];
      const after = bestBuy(s, boardInfo(s, wi), 1);
      const half = Math.floor(u.val * 0.5);
      const val = u.type === 'miner' ? '+' + (stats('miner', u.tier).income * s.mode.income).toFixed(2) + ' 🪙/s' : T.aura ? '+' + Math.round(stats(u.type, u.tier).aura * 100) + '% damage to neighbours' : 'DPS ' + fmt(stats(u.type, u.tier).dps);
      let text = 'No room. Sell ' + T.name + ' (level ' + u.tier + ') — least valuable (' + val + '), returns +' + half + ' 🪙. Then buy ' + TYPES[after.type].name + '.';
      return { kind: 'sell', slot: wi, type: after.type, text };
    }

    const best = bestBuy(s, b, b.free);
    let text = best.why;
    if (!best.merges && b.free <= 3) text += ' Free slots: ' + b.free + '.';
    if (s.coins < best.cost) text += ' Need ' + Math.ceil(best.cost - s.coins) + ' more 🪙.';
    return { kind: 'buy', type: best.type, merges: best.merges, text };
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
    const counts = zeroCounts();
    for (const u of s.slots) if (u) counts[u.type]++;
    let pick;
    const atk = ATTACKERS.reduce((a, k) => a + counts[k], 0);
    if (atk >= 2 && counts.miner < 2 && s.wave < 8) pick = 'miner';
    else {
      pick = 'archer';
      const pool = ['archer', 'gunner', 'cannon', 'mage'];
      if (s.wave >= 5) pool.push('sniper');
      if (s.wave >= 3) pool.push('flame');
      if (s.wave >= 6) pool.push('tesla');
      for (const k of pool) if (counts[k] < counts[pick]) pick = k;
    }
    if (s.coins >= cost(s, pick)) buy(s, pick);
  }

  // Bot that follows the in-game advice (tests the advisor itself)
  function botSmart(s) {
    const a = advise(s);
    if (a.kind === 'merge') { move(s, a.a, a.b); return; }
    if (a.kind === 'sell') {
      if (s.coins + Math.floor(s.slots[a.slot].val * 0.5) >= cost(s, a.type)) { sell(s, a.slot); buy(s, a.type); }
      return;
    }
    if (s.coins >= cost(s, a.type)) buy(s, a.type);
  }

  const Core = {
    W, H, COLS, ROWS, NSLOTS, CELL, PITCH, GRID_X, GRID_Y, PANEL_Y, PANEL_H, SHOP_Y, SHOP_BH, MAXTIER, LEN, PATH, MAPS, MAP_KEYS,
    TYPES, TYPE_KEYS, ENEMIES, MODES, MODE_KEYS,
    posAt, slotPos, slotAt, shopRect, stats, neighbours, auraAt, create, cost, income, passiveIncome, minerIncome, earlyBonus,
    isBossWave, bossNext, previewCounts, buy, canMerge, move, sell, callWave, update, advise, fmt, bot, botSmart, activateAuto, autoInfo, activateDouble, dblInfo, revive, BOSSES, bossVariant, AUTO_TIME, AUTO_CD, DBL_TIME, DBL_CD
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(this);
