// Balance simulation: a simple bot plays N games per mode, prints waves reached.
const C = require('../www/core.js');
const runs = parseInt(process.argv[2] || '8', 10);
for (const mode of C.MODE_KEYS) {
  const res = [];
  for (let r = 0; r < runs; r++) {
    const s = C.create(mode);
    let t = 0, k = 0;
    while (!s.over && t < 3600) {
      C.update(s, 0.05); t += 0.05; k++;
      if (k % 6 === 0) C.bot(s);   // bot acts ~3x/sec
    }
    res.push({ wave: s.wave, secs: Math.round(t) });
  }
  res.sort((a, b) => a.wave - b.wave);
  const m = res[Math.floor(res.length / 2)];
  console.log(mode.padEnd(7), 'waves:', res.map(r => r.wave).join(' '), '| median', m.wave, 'in', m.secs + 's');
}
