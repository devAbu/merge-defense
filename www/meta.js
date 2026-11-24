// Merge Defense - meta progression: stars, upgrades, daily reward/streak, daily tasks, achievements.
// Pure logic + a tiny storage adapter, so it can be tested in Node.
(function (root) {
  'use strict';

  const BOSS_KEYS = ['golem', 'drake', 'guard', 'necro'];

  const UPS = {
    start:  { name: 'Starting coins', emoji: '💰', max: 5, costs: [3, 5, 8, 12, 18], desc: l => '+' + l * 5 + ' 🪙 at the start of a game', per: '+5 🪙' },
    income: { name: 'Income',          emoji: '📈', max: 5, costs: [4, 6, 9, 13, 19], desc: l => '+' + l * 10 + '% of all coins', per: '+10%' },
    life:   { name: 'Extra life',   emoji: '❤️', max: 3, costs: [6, 12, 20],       desc: l => '+' + l + ' lives', per: '+1 ❤️' },
    dmg:    { name: 'Stronger units',    emoji: '💥', max: 5, costs: [4, 7, 10, 14, 20], desc: l => '+' + l * 8 + '% damage', per: '+8%' }
  };
  const UP_KEYS = ['start', 'income', 'life', 'dmg'];

  const DAILY = [10, 15, 20, 25, 30, 40, 60]; // bonus start coins for day 1..7 of the streak
  const DAILY_STARS_DAY7 = 5;

  const ACH = [
    { id: 'merge1',  emoji: '🔗', name: 'First merge',         desc: 'Merge two units',              stars: 1, f: s => s.merges >= 1 },
    { id: 'merge50', emoji: '⚙️', name: 'Merge master',        desc: 'Merge 50 times',                  stars: 2, f: s => s.merges >= 50 },
    { id: 'tier5',   emoji: '🥉', name: 'Level 5',            desc: 'Make a level 5 unit',        stars: 2, f: s => s.maxTier >= 5 },
    { id: 'tier8',   emoji: '👑', name: 'Max level',          desc: 'Make a level 8 unit',        stars: 5, f: s => s.maxTier >= 8 },
    { id: 'kill100', emoji: '🧟', name: 'Hunter',             desc: 'Kill 100 enemies',          stars: 1, f: s => s.kills >= 100 },
    { id: 'kill1k',  emoji: '💀', name: 'Devastation',        desc: 'Kill 1000 enemies',         stars: 4, f: s => s.kills >= 1000 },
    { id: 'boss1',   emoji: '👹', name: 'First boss',         desc: 'Defeat any boss',       stars: 3, f: s => bossTotal(s) >= 1 },
    { id: 'bossAll', emoji: '🏹', name: 'Boss hunter',        desc: 'Defeat all 4 different bosses',  stars: 8, f: s => BOSS_KEYS.every(k => (s.bossKills[k] || 0) > 0) },
    { id: 'w20',     emoji: '🌊', name: 'Wave 20',            desc: 'Reach wave 20',             stars: 3, f: s => bestAny(s) >= 20 },
    { id: 'w30',     emoji: '🚀', name: 'Wave 30',            desc: 'Reach wave 30',             stars: 6, f: s => bestAny(s) >= 30 },
    { id: 'hard15',  emoji: '🔥', name: 'Resilient',          desc: 'Wave 15 on Hard',              stars: 5, f: s => (s.bestWave.hard || 0) >= 15 },
    { id: 'games10', emoji: '🎮', name: 'Loyal player',       desc: 'Play 10 games',               stars: 2, f: s => s.games >= 10 },
    { id: 'video3',  emoji: '🎬', name: 'Viewer',             desc: 'Use 3 video bonuses',       stars: 1, f: s => s.videos >= 3 },
    { id: 'chest5',  emoji: '🎁', name: 'Treasure collector', desc: 'Open 5 chests',               stars: 2, f: s => s.chests >= 5 },
    { id: 'streak7', emoji: '📆', name: 'Full week',          desc: '7-day streak',                  stars: 5, f: s => s.bestStreak >= 7 }
  ];

  const TASKS = [
    { id: 'kills',  emoji: '🧟', text: n => 'Kill ' + n + ' enemies',     goal: [60, 100, 160], stars: 2 },
    { id: 'merges', emoji: '🔗', text: n => 'Merge units ' + n + ' times',    goal: [10, 16, 24],   stars: 2 },
    { id: 'buys',   emoji: '🛒', text: n => 'Buy ' + n + ' units',          goal: [12, 20, 30],   stars: 2 },
    { id: 'wave',   emoji: '🌊', text: n => 'Reach wave ' + n,       goal: [8, 12, 16],    stars: 3, max: true },
    { id: 'calls',  emoji: '▶️', text: n => 'Call a wave early ' + n + ' times', goal: [4, 8, 12],  stars: 2 },
    { id: 'boss',   emoji: '👹', text: n => 'Defeat a boss',                   goal: [1, 1, 1],      stars: 4 }
  ];

  function bossTotal(s) { let t = 0; for (const k of BOSS_KEYS) t += s.bossKills[k] || 0; return t; }
  function bestAny(s) { let m = 0; for (const k in s.bestWave) m = Math.max(m, s.bestWave[k]); return m; }

  function dayNum(date) { // local calendar day number
    const d = date || new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function fresh() {
    return {
      stars: 0, ups: { start: 0, income: 0, life: 0, dmg: 0 },
      streak: 0, bestStreak: 0, lastDay: -1, bonus: 0,
      ach: {}, tasks: { day: -1, list: [] },
      st: { games: 0, kills: 0, merges: 0, buys: 0, calls: 0, videos: 0, chests: 0, maxTier: 1, bestWave: {}, bossKills: {} }
    };
  }

  // Validates/cleans a progress object coming from outside (backup code). Returns a safe copy or null.
  function sanitize(j) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const d = fresh();
    const num = (v, max) => { v = Number(v); return isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0; };
    d.stars = num(j.stars, 1e7);
    for (const k of Object.keys(UPS)) d.ups[k] = Math.min(UPS[k].max, num(j.ups && j.ups[k], 99));
    d.streak = num(j.streak, 100000); d.bestStreak = num(j.bestStreak, 100000);
    d.lastDay = isFinite(Number(j.lastDay)) ? Math.floor(Number(j.lastDay)) : -1;
    d.bonus = num(j.bonus, 100000);
    for (const a of ACH) if (j.ach && j.ach[a.id]) d.ach[a.id] = num(j.ach[a.id], 1e14) || 1;
    d.tasks = { day: -1, list: [] }; // daily tasks are regenerated for today
    const st = j.st || {};
    for (const k of ['games', 'kills', 'merges', 'buys', 'calls', 'videos', 'chests']) d.st[k] = num(st[k], 1e9);
    d.st.maxTier = Math.max(1, num(st.maxTier, 99));
    for (const k in (st.bestWave || {})) if (/^[a-z]{1,10}$/.test(k)) d.st.bestWave[k] = num(st.bestWave[k], 9999);
    for (const k of BOSS_KEYS) if (st.bossKills && st.bossKills[k]) d.st.bossKills[k] = num(st.bossKills[k], 1e6);
    return d;
  }

  function seeded(n) { // tiny deterministic PRNG for the daily task pick
    let x = (n * 2654435761) >>> 0;
    return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  }

  function create(store, nowFn) {
    const KEY = 'md3_meta';
    const now = nowFn || function () { return new Date(); };
    let d = fresh();
    try {
      const raw = store.getItem(KEY);
      if (raw) {
        const j = JSON.parse(raw);
        d = Object.assign(fresh(), j);
        d.ups = Object.assign(fresh().ups, j.ups || {});
        d.st = Object.assign(fresh().st, j.st || {});
        d.tasks = j.tasks || fresh().tasks;
      }
    } catch (e) { d = fresh(); }
    let dirty = false;
    const popups = [];

    function touch() { dirty = true; }
    function save() { if (!dirty) return; dirty = false; try { store.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }
    function addStars(n, why) { d.stars += n; touch(); if (why) popups.push('⭐ +' + n + ' ' + why); }

    // ----- achievements -----
    function checkAch() {
      const out = [];
      for (const a of ACH) {
        if (!d.ach[a.id] && a.f(d.st)) {
          d.ach[a.id] = now().getTime();
          d.stars += a.stars; touch();
          out.push(a);
          popups.push(a.emoji + ' ' + a.name + '  +' + a.stars + '⭐');
        }
      }
      return out;
    }

    // ----- daily tasks -----
    function ensureTasks() {
      const day = dayNum(now());
      if (d.tasks.day === day) return;
      const rnd = seeded(day + 17);
      const pool = TASKS.slice();
      const list = [];
      for (let i = 0; i < 3; i++) {
        const t = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        const lvl = Math.min(2, Math.floor(rnd() * 3));
        list.push({ id: t.id, goal: t.goal[lvl], prog: 0, done: false });
      }
      d.tasks = { day, list }; touch();
    }
    function taskDef(id) { return TASKS.find(t => t.id === id); }
    function progress(id, n) {
      ensureTasks();
      for (const t of d.tasks.list) {
        if (t.id !== id || t.done) continue;
        const def = taskDef(id);
        t.prog = def.max ? Math.max(t.prog, n) : t.prog + n;
        if (t.prog >= t.goal) { t.prog = t.goal; t.done = true; addStars(def.stars, '– task done'); }
        touch();
      }
    }

    // ----- stats feed (called by the game) -----
    const api = {
      data: d, UPS, UP_KEYS, ACH, TASKS, BOSS_KEYS, DAILY, DAILY_STARS_DAY7, popups,
      save, ensureTasks, taskDef,
      get stars() { return d.stars; },
      onKill: function (n) { d.st.kills += n || 1; progress('kills', n || 1); touch(); checkAch(); },
      onMerge: function (tier) { d.st.merges++; d.st.maxTier = Math.max(d.st.maxTier, tier); progress('merges', 1); touch(); checkAch(); },
      onBuy: function () { d.st.buys++; progress('buys', 1); touch(); },
      onCall: function () { d.st.calls++; progress('calls', 1); touch(); },
      onVideo: function () { d.st.videos++; touch(); checkAch(); },
      onChest: function () { d.st.chests++; touch(); checkAch(); },
      onWave: function (w, mode) {
        progress('wave', w);
        if (mode && w > (d.st.bestWave[mode] || 0)) { d.st.bestWave[mode] = w; touch(); checkAch(); }
      },
      onBoss: function (variant) {
        const k = BOSS_KEYS[variant % BOSS_KEYS.length];
        d.st.bossKills[k] = (d.st.bossKills[k] || 0) + 1;
        progress('boss', 1); touch(); checkAch();
      },
      // run finished (or abandoned): pay stars, update bests. Returns stars paid now.
      finishRun: function (run) {
        // run: { mode, wave, bosses, paid }
        const total = Math.floor(run.wave * 0.8) + run.bosses * 3;
        const pay = Math.max(0, total - (run.paid || 0));
        run.paid = total;
        if (!run.counted) { run.counted = true; d.st.games++; }
        d.st.bestWave[run.mode] = Math.max(d.st.bestWave[run.mode] || 0, run.wave);
        if (pay > 0) addStars(pay);
        touch(); checkAch(); save();
        return pay;
      },
      addStars: addStars,
      checkAch: checkAch,
      hasAch: function (id) { return !!d.ach[id]; },
      achCount: function () { return Object.keys(d.ach).length; },
      tasksList: function () { ensureTasks(); return d.tasks.list; },
      tasksDone: function () { ensureTasks(); return d.tasks.list.filter(t => t.done).length; },

      // ----- upgrades -----
      upLevel: function (k) { return d.ups[k] || 0; },
      upCost: function (k) { const l = d.ups[k] || 0; return l >= UPS[k].max ? 0 : UPS[k].costs[l]; },
      buyUp: function (k) {
        const c = api.upCost(k);
        if (!c || d.stars < c) return false;
        d.stars -= c; d.ups[k]++; touch(); save();
        return true;
      },
      // values passed into Core.create
      coreMeta: function (extraInc) {
        const b = d.bonus || 0;
        d.bonus = 0; touch();
        return {
          coins: d.ups.start * 5 + b,
          inc: (1 + 0.10 * d.ups.income) * (extraInc || 1),
          lives: d.ups.life,
          dmg: 1 + 0.08 * d.ups.dmg
        };
      },

      // ----- daily reward / streak -----
      dailyAvailable: function () { return d.lastDay !== dayNum(now()); },
      // streak the player will have if claimed now (missed days shrink the streak instead of wiping it)
      dailyPreview: function () {
        const today = dayNum(now());
        if (d.lastDay === today) return d.streak;
        if (d.lastDay < 0) return 1;
        const gap = today - d.lastDay;
        return Math.max(0, d.streak - (gap - 1)) + 1;
      },
      dailyClaim: function (doubled) {
        if (!api.dailyAvailable()) return null;
        const streak = api.dailyPreview();
        d.streak = streak; d.bestStreak = Math.max(d.bestStreak, streak);
        d.lastDay = dayNum(now());
        const idx = (streak - 1) % 7;
        const coins = DAILY[idx] * (doubled ? 2 : 1);
        d.bonus = (d.bonus || 0) + coins;
        let stars = 0;
        if (idx === 6) { stars = DAILY_STARS_DAY7 * (doubled ? 2 : 1); d.stars += stars; }
        if (doubled) d.st.videos++;
        touch(); checkAch(); save();
        return { streak, idx, coins, stars };
      },
      pendingBonus: function () { return d.bonus || 0; }
    };
    ensureTasks();
    return api;
  }

  root.Meta = { create: create, fresh: fresh, dayNum: dayNum, sanitize: sanitize };
  if (typeof module !== 'undefined') module.exports = root.Meta;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
