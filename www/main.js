// Merge Defense - rendering + input
(function () {
  'use strict';
  const C = Core;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const demo = /demo/.test(location.search);

  let scale = 1, ox = 0, oy = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    scale = Math.min(w / C.W, h / C.H);
    ox = (w - C.W * scale) / 2;
    oy = (h - C.H * scale) / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- storage ----
  function load(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  let best = parseInt(load('md_best', '0'), 10) || 0;
  let seenIntro = load('md_seen', '0') === '1';
  let s = C.create();
  let paused = !seenIntro;
  let overAt = 0;
  let flash = { t: 0, msg: '' };
  let drag = null; // {from, x, y, moved}
  let hidden = false;

  function say(msg) { flash = { t: 1.6, msg }; }

  if (demo) {
    seenIntro = true; paused = false;
    for (let i = 0; i < 20 * 60 * 3; i++) { C.update(s, 1 / 20); if (i % 6 === 0) C.bot(s); if (s.over) break; }
  }

  // ---- input ----
  function toLogical(e) {
    return [(e.clientX - ox) / scale, (e.clientY - oy) / scale];
  }
  function inShop(y) { return y >= C.SHOP_Y - 6; }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    const [x, y] = toLogical(e);
    if (paused) { seenIntro = true; save('md_seen', '1'); paused = false; return; }
    if (s.over) {
      if (performance.now() - overAt > 700) { s = C.create(); }
      return;
    }
    // shop buttons
    if (y >= C.SHOP_Y && y <= C.SHOP_Y + C.SHOP_H) {
      const bi = Math.floor((x - 12) / 114);
      if (bi >= 0 && bi < 3 && x >= 12 + bi * 114 && x <= 12 + bi * 114 + 108) {
        const r = C.buy(s, C.TYPE_KEYS[bi]);
        if (r === -2) say('Nema slobodnog mjesta!');
        else if (r === -3) say('Nemaš dovoljno novčića');
      }
      return;
    }
    // call wave button
    if (x >= 196 && x <= 350 && y >= 254 && y <= 284) {
      const b = C.callWave(s);
      if (b > 0) say('Bonus +' + b + ' 🪙');
      return;
    }
    const i = C.slotAt(x, y);
    if (i >= 0 && s.slots[i]) {
      drag = { from: i, x, y, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    e.preventDefault();
    const [x, y] = toLogical(e);
    drag.x = x; drag.y = y; drag.moved = true;
  });
  function endDrag(e) {
    if (!drag) return;
    const [x, y] = toLogical(e);
    const from = drag.from;
    if (drag.moved) {
      if (inShop(y)) {
        const g = C.sell(s, from);
        if (g > 0) say('Prodano +' + g + ' 🪙');
      } else {
        const to = C.slotAt(x, y);
        if (to >= 0) {
          const r = C.move(s, from, to);
          if (r === 'merge') { say('Spojeno! ⬆️'); if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* ignore */ } } }
        }
      }
    }
    drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', function () { drag = null; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('visibilitychange', function () { hidden = document.hidden; });

  // ---- drawing helpers ----
  const TIER_COL = ['#9aa3ad', '#7bd36d', '#4fc3f7', '#b388ff', '#ff8a65', '#ffd54f', '#ff5252', '#f48fb1'];
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function text(str, x, y, size, color, align, weight) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px sans-serif';
    ctx.fillStyle = color || '#fff';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function emoji(str, x, y, size) {
    ctx.font = size + 'px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(str, x, y + 1);
  }

  function drawUnit(u, x, y, size, alpha) {
    const T = C.TYPES[u.type];
    ctx.globalAlpha = alpha || 1;
    rr(x - size / 2, y - size / 2, size, size, 12);
    ctx.fillStyle = T.color;
    ctx.fill();
    ctx.lineWidth = 3 + (u.tier >= 5 ? 1 : 0);
    ctx.strokeStyle = TIER_COL[u.tier - 1];
    ctx.stroke();
    emoji(T.emoji, x, y - 2, size * 0.52);
    // tier badge
    ctx.beginPath();
    ctx.arc(x + size / 2 - 11, y + size / 2 - 11, 10, 0, Math.PI * 2);
    ctx.fillStyle = TIER_COL[u.tier - 1];
    ctx.fill();
    text(String(u.tier), x + size / 2 - 11, y + size / 2 - 10.5, 12, '#111', 'center');
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f1a14';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
    ctx.beginPath(); ctx.rect(0, 0, C.W, C.H); ctx.clip();

    // background
    const g = ctx.createLinearGradient(0, 0, 0, C.H);
    g.addColorStop(0, '#1d3a2a'); g.addColorStop(1, '#122219');
    ctx.fillStyle = g; ctx.fillRect(0, 0, C.W, C.H);

    // HUD
    text('🪙 ' + Math.floor(s.coins), 12, 22, 22, '#ffd84a');
    text('+' + C.income(s).toFixed(1) + '/s', 12, 40, 11, '#b9c7bd', 'left', 'normal');
    text('Talas ' + s.wave, C.W / 2, 22, 18, '#ffffff', 'center');
    text('Rekord ' + Math.max(best, s.wave), C.W / 2, 40, 11, '#b9c7bd', 'center', 'normal');
    text('❤️ ' + s.lives, C.W - 12, 22, 22, '#ff8080', 'right');

    // field
    rr(6, 50, C.W - 12, 200, 14);
    ctx.fillStyle = '#2c5a3c'; ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.rect(6, 50, C.W - 12, 200); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    C.PATH.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = '#6b5436'; ctx.lineWidth = 36; ctx.stroke();
    ctx.strokeStyle = '#c9a66b'; ctx.lineWidth = 30; ctx.stroke();
    // enemies
    const sorted = s.enemies.slice().sort((a, b) => a.y - b.y);
    for (const e of sorted) {
      const big = e.kind === 'boss' ? 34 : 24;
      emoji(C.ENEMIES[e.kind].emoji, e.x, e.y, big);
      const bw = e.kind === 'boss' ? 34 : 24;
      ctx.fillStyle = '#00000088'; ctx.fillRect(e.x - bw / 2, e.y - big / 2 - 4, bw, 4);
      ctx.fillStyle = e.hp / e.max > 0.4 ? '#5ee06a' : '#ff6b4a';
      ctx.fillRect(e.x - bw / 2, e.y - big / 2 - 4, bw * Math.max(0, e.hp / e.max), 4);
    }
    // shots (from towers below the field, clipped to field)
    for (const a of s.shots) {
      ctx.globalAlpha = 1 - a.t / 0.12;
      ctx.strokeStyle = a.type === 'gunner' ? '#ffe066' : a.type === 'cannon' ? '#ff9a4a' : '#e8f5e9';
      ctx.lineWidth = a.type === 'cannon' ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const r of s.rings) {
      if (r.y > 250) continue;
      ctx.globalAlpha = 1 - r.t / 0.4;
      ctx.strokeStyle = r.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, (r.r || 30) * (r.t / 0.4), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    for (const a of s.texts) {
      ctx.globalAlpha = 1 - a.t / 0.9;
      text(a.s, a.x, a.y - a.t * 28, 14, a.c || '#ffd84a', 'center');
    }
    ctx.globalAlpha = 1;

    // wave bar
    text(s.queue.length ? 'Neprijatelji dolaze… (' + s.queue.length + ')' : 'Sljedeći talas za ' + Math.ceil(Math.max(0, s.waveTimer)) + 's', 12, 269, 13, '#e6efe8', 'left', 'normal');
    const eb = C.earlyBonus(s);
    const canCall = s.waveTimer > 3 && !s.over;
    rr(196, 254, 154, 30, 10);
    ctx.fillStyle = canCall ? '#e0a526' : '#555'; ctx.fill();
    text('▶ Pozovi talas' + (eb > 0 ? ' +' + eb + '🪙' : ''), 273, 269, 13, '#1b1b1b', 'center');

    // grid
    for (let i = 0; i < C.NSLOTS; i++) {
      const c = i % C.COLS, r = Math.floor(i / C.COLS);
      const sx = C.GRID_X + c * C.PITCH, sy = C.GRID_Y + r * C.PITCH;
      rr(sx, sy, C.CELL, C.CELL, 12);
      ctx.fillStyle = '#00000044'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff22'; ctx.stroke();
    }
    // highlight merge targets while dragging
    let hover = -1;
    if (drag && drag.moved) {
      hover = C.slotAt(drag.x, drag.y);
      for (let i = 0; i < C.NSLOTS; i++) {
        if (i !== drag.from && C.canMerge(s, drag.from, i)) {
          const p = C.slotPos(i);
          rr(p[0] - 33, p[1] - 33, 66, 66, 14);
          ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 3; ctx.stroke();
        }
      }
    }
    for (let i = 0; i < C.NSLOTS; i++) {
      const u = s.slots[i];
      if (!u) continue;
      if (drag && drag.moved && drag.from === i) continue;
      const p = C.slotPos(i);
      drawUnit(u, p[0], p[1], 60);
    }
    for (const r of s.rings) {
      if (r.y <= 250) continue;
      ctx.globalAlpha = 1 - r.t / 0.4;
      ctx.strokeStyle = r.c; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, 14 + 26 * (r.t / 0.4), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // shop
    const selling = drag && drag.moved && inShop(drag.y);
    for (let i = 0; i < 3; i++) {
      const k = C.TYPE_KEYS[i], T = C.TYPES[k];
      const x = 12 + i * 114, y = C.SHOP_Y;
      const cst = C.cost(s, k);
      const ok = s.coins >= cst && !s.over;
      rr(x, y, 108, C.SHOP_H, 14);
      ctx.fillStyle = selling ? '#7a2b2b' : ok ? T.color : '#3a423d';
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = ok ? '#ffffff88' : '#ffffff22'; ctx.stroke();
      ctx.globalAlpha = ok ? 1 : 0.55;
      emoji(T.emoji, x + 28, y + 32, 30);
      text(T.name, x + 50, y + 22, 13, '#fff');
      text('🪙 ' + cst, x + 50, y + 42, 15, '#ffd84a');
      ctx.globalAlpha = 1;
    }
    if (selling) {
      const u = s.slots[drag.from];
      text('PRODAJ  +' + Math.floor(u.val * 0.5) + ' 🪙', C.W / 2, C.SHOP_Y + 32, 20, '#fff', 'center');
    }
    text('Povuci dva ISTA vojnika jedan na drugog = spajanje', C.W / 2, 604, 12, '#b9c7bd', 'center', 'normal');
    text('Povuci vojnika dolje na dugmad = prodaja', C.W / 2, 622, 11, '#8fa296', 'center', 'normal');

    // dragged unit
    if (drag && drag.moved) drawUnit(s.slots[drag.from], drag.x, drag.y - 20, 66, 0.92);

    // flash
    if (flash.t > 0) {
      ctx.globalAlpha = Math.min(1, flash.t * 2);
      rr(C.W / 2 - 110, 296 + 0, 220, 0, 0);
      text(flash.msg, C.W / 2, 290, 15, '#fff', 'center');
      ctx.globalAlpha = 1;
    }

    // overlays
    if (paused) {
      ctx.fillStyle = '#000000cc'; ctx.fillRect(0, 0, C.W, C.H);
      text('MERGE DEFENSE', C.W / 2, 120, 30, '#ffd84a', 'center');
      const lines = [
        '1. Kupi vojnike dolje (🏹 🔫 💣)',
        '2. Povuci dva ISTA vojnika jedan',
        '    na drugog — spoje se u jačeg ⬆️',
        '3. Novčići rastu sami i kad ubiješ',
        '    neprijatelje 🪙',
        '4. Ne daj ih do kraja puta ❤️',
        '5. Višak vojnika prodaj povlačenjem dolje'
      ];
      lines.forEach((l, i) => text(l, 36, 200 + i * 30, 17, '#fff', 'left', 'normal'));
      text('Tapni za početak', C.W / 2, 470, 22, '#7bd36d', 'center');
    }
    if (s.over) {
      ctx.fillStyle = '#000000b0'; ctx.fillRect(0, 0, C.W, C.H);
      text('KRAJ IGRE', C.W / 2, 220, 36, '#ff6b6b', 'center');
      text('Talas: ' + s.wave, C.W / 2, 280, 24, '#fff', 'center');
      text('Rekord: ' + best, C.W / 2, 315, 18, '#ffd84a', 'center');
      text('Ubijeno: ' + s.kills, C.W / 2, 345, 16, '#b9c7bd', 'center', 'normal');
      text('Tapni za novu igru', C.W / 2, 420, 22, '#7bd36d', 'center');
    }
  }

  // ---- loop ----
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (!paused && !hidden && !s.over) {
      C.update(s, dt);
      if (s.wave > best) { best = s.wave; save('md_best', String(best)); }
      if (s.over) overAt = performance.now();
    }
    if (flash.t > 0) flash.t -= dt;
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
