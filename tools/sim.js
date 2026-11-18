// Balance simulation: a simple bot plays N games, prints waves reached.
const C = require('../www/core.js');
const runs = parseInt(process.argv[2] || '10', 10);
const res = [];
for (let r = 0; r < runs; r++) {
  const s = C.create();
  let t = 0;
  while (!s.over && t < 3600) {
    C.update(s, 0.05); t += 0.05;
    if (Math.round(t / 0.05) % 6 === 0) C.bot(s);   // bot acts ~3x/sec
  }
  res.push({ wave: s.wave, secs: Math.round(t) });
}
res.sort((a, b) => a.wave - b.wave);
console.log('waves reached:', res.map(r => r.wave).join(' '));
console.log('median wave', res[Math.floor(res.length / 2)].wave, 'median time(s)', res[Math.floor(res.length / 2)].secs);
