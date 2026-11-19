// Balance simulation: bots play N games per mode, prints waves reached.
// usage: node tools/sim.js [runs] [simple|smart]
const C = require('../www/core.js');
const runs = parseInt(process.argv[2] || '6', 10);
const kind = process.argv[3] || 'both';
function play(mode, smart, auto) {
  const s = C.create(mode);
  let t = 0, k = 0, fullTicks = 0, merged = 0;
  while (!s.over && t < 3600) {
    C.update(s, 0.05); t += 0.05; k++;
    if (auto && s.autoCd === 0 && s.autoT === 0) C.activateAuto(s);
    if (k % 6 === 0) {
      const before = s.slots.filter(Boolean).length;
      (smart ? C.botSmart : C.bot)(s);
      if (before === 15) fullTicks++;
    }
    s.events.length = 0;
  }
  return { wave: s.wave, secs: Math.round(t), full: fullTicks };
}
for (const smart of [false, true]) {
  if (kind === 'simple' && smart) continue;
  if (kind === 'smart' && !smart) continue;
  for (const mode of C.MODE_KEYS) {
    const res = [];
    for (let r = 0; r < runs; r++) res.push(play(mode, smart));
    res.sort((a, b) => a.wave - b.wave);
    const m = res[Math.floor(res.length / 2)];
    console.log((smart ? 'smart ' : 'simple') + ' ' + mode.padEnd(7), 'waves:', res.map(r => r.wave).join(' '), '| median', m.wave, 'in', m.secs + 's', '| full-board ticks', m.full);
  }
}
// auto-merge sanity
const s = C.create('normal');
for (let i = 0; i < 6; i++) { s.coins = 999; C.buy(s, 'archer'); }
console.log('auto: before units', s.slots.filter(Boolean).length, 'activate', C.activateAuto(s), 'again', C.activateAuto(s));
for (let i = 0; i < 20 * 61; i++) C.update(s, 0.05);
console.log('auto: after 61s units', s.slots.filter(Boolean).length, 'info', JSON.stringify(C.autoInfo(s)).slice(0, 60));
for (let i = 0; i < 20 * 16; i++) C.update(s, 0.05);
console.log('auto: after cooldown', JSON.stringify(C.autoInfo(s)));
