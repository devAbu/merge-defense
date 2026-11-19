// Merge Defense v2 - rendering + input
(function () {
  'use strict';
  const C = Core;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const Q = new URLSearchParams(location.search);

  const FONT = '-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
  const EMOJI_FONT = '"Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif';
  const TIER_COL = ['#9aa7c0', '#6be08a', '#4cc9ff', '#b78cff', '#ff9a62', '#ffd54a', '#ff5d5d', '#ff8ad8'];
  const MODE_COL = { easy: '#3ddc84', normal: '#5b8cff', hard: '#ff5a5a' };

  // ---------- canvas sizing ----------
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

  // ---------- storage ----------
  function load(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  const best = {};
  C.MODE_KEYS.forEach(k => { best[k] = parseInt(load('md2_best_' + k, '0'), 10) || 0; });

  // ---------- state ----------
  let scene = load('md2_seen', '0') === '1' ? 'menu' : 'guide';
  let guideFrom = 'menu';
  let modeKey = 'normal';
  let s = C.create(modeKey);
  let sel = -1;
  let drag = null;
  let toast = { t: 0, msg: '' };
  let buttons = [];
  let hidden = false;
  let newBest = false;
  let overAt = 0;
  let clock = 0;

  function say(msg) { toast = { t: 1.8, msg }; }

  function startGame(k) {
    modeKey = k;
    s = C.create(k);
    sel = -1; drag = null; newBest = false;
    scene = 'play';
  }

  // URL hooks for testing / screenshots
  if (Q.get('mode') && C.MODES[Q.get('mode')]) modeKey = Q.get('mode');
  if (Q.get('demo')) {
    startGame(modeKey);
    const secs = parseInt(Q.get('demo'), 10) > 1 ? parseInt(Q.get('demo'), 10) : 150;
    for (let i = 0, n = secs * 20; i < n; i++) { C.update(s, 0.05); if (i % 6 === 0) C.bot(s); if (s.over) break; }
    for (let i = 0; i < 8; i++) C.update(s, 0.05);
    if (Q.get('sel')) sel = parseInt(Q.get('sel'), 10);
    if (Q.get('boss')) { s.wave = 9; s.waveTimer = 14; s.nextQ = ['boss', 'grunt', 'grunt']; }
  }
  if (Q.get('scene')) scene = Q.get('scene');
  if (scene === 'over' && !s.over) { s.over = true; s.wave = 17; s.kills = 211; newBest = true; }

  // ---------- helpers ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function vgrad(y0, y1, c0, c1) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    return g;
  }
  function text(str, x, y, size, color, align, weight) {
    ctx.font = (weight || '700') + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color || '#fff';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function emoji(str, x, y, size) {
    ctx.font = size + 'px ' + EMOJI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(str, x, y + 1);
  }
  function outlined(str, x, y, size, color, weight) {
    ctx.font = (weight || '800') + ' ' + size + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function wrap(str, maxW, size, weight) {
    ctx.font = (weight || '500') + ' ' + size + 'px ' + FONT;
    const words = str.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function card(x, y, w, h, r, fill, stroke) {
    rr(x, y, w, h, r);
    ctx.fillStyle = fill || 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke || 'rgba(255,255,255,0.10)';
    ctx.stroke();
  }
  // Registers a tappable rectangle and draws it
  function button(id, x, y, w, h, o) {
    o = o || {};
    buttons.push({ id, x, y, w, h });
    rr(x, y, w, h, o.r || 14);
    if (o.c1) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, o.c1); g.addColorStop(1, o.c2 || o.c1);
      ctx.fillStyle = g;
    } else ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.globalAlpha = o.dim ? 0.5 : 1;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = o.stroke || 'rgba(255,255,255,0.18)';
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (o.label) text(o.label, x + w / 2, y + h / 2 + 1, o.size || 15, o.color || '#fff', 'center', '800');
  }
  const fmt = C.fmt;

  // ---------- input ----------
  function toLogical(e) { return [(e.clientX - ox) / scale, (e.clientY - oy) / scale]; }
  function hitButton(x, y) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      const b = buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  function act(id) {
    if (id.startsWith('mode:')) { startGame(id.slice(5)); return; }
    if (id.startsWith('buy:')) {
      const r = C.buy(s, id.slice(4));
      if (r === -2) say('Nema slobodnog mjesta! Spoji ili prodaj.');
      else if (r === -3) say('Nemaš dovoljno novčića 🪙');
      else if (r >= 0) sel = r;
      return;
    }
    switch (id) {
      case 'pause': scene = 'pause'; break;
      case 'resume': scene = 'play'; break;
      case 'menu': scene = 'menu'; break;
      case 'guide': guideFrom = scene; scene = 'guide'; break;
      case 'closeGuide': save('md2_seen', '1'); scene = guideFrom === 'pause' ? 'pause' : 'menu'; guideFrom = 'menu'; break;
      case 'restart': startGame(modeKey); break;
      case 'again': startGame(modeKey); break;
      case 'call': {
        const b = C.callWave(s);
        if (b > 0) say('Pozvan talas ranije: bonus +' + b + ' 🪙');
        break;
      }
      case 'sell': {
        if (sel >= 0) { const g = C.sell(s, sel); if (g > 0) say('Prodano +' + g + ' 🪙'); sel = -1; }
        break;
      }
      default: break;
    }
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    const [x, y] = toLogical(e);
    const id = hitButton(x, y);
    if (id) { act(id); return; }
    if (scene !== 'play') return;
    const i = C.slotAt(x, y);
    if (i >= 0 && s.slots[i]) {
      drag = { from: i, x, y, sx: x, sy: y, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else {
      sel = -1;
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    e.preventDefault();
    const [x, y] = toLogical(e);
    drag.x = x; drag.y = y;
    if (Math.hypot(x - drag.sx, y - drag.sy) > 8) drag.moved = true;
  });
  function endDrag(e) {
    if (!drag) return;
    const [x, y] = toLogical(e);
    const from = drag.from;
    if (!drag.moved) {
      sel = sel === from ? -1 : from;
    } else if (y >= C.SHOP_Y - 8) {
      const g = C.sell(s, from);
      if (g > 0) say('Prodano +' + g + ' 🪙');
      if (sel === from) sel = -1;
    } else {
      const to = C.slotAt(x, y);
      if (to >= 0) {
        const r = C.move(s, from, to);
        if (r === 'merge') { say('Spojeno! ⬆️'); sel = to; if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* ignore */ } } }
        else if (r) sel = to;
      }
    }
    drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', function () { drag = null; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('visibilitychange', function () {
    hidden = document.hidden;
    if (hidden && scene === 'play') scene = 'pause';
  });

  // ---------- drawing: pieces ----------
  function drawBackground() {
    ctx.fillStyle = vgrad(0, C.H, '#0c1226', '#161f3f');
    ctx.fillRect(0, 0, C.W, C.H);
    const g = ctx.createRadialGradient(C.W / 2, 0, 10, C.W / 2, 0, 420);
    g.addColorStop(0, 'rgba(91,140,255,0.20)');
    g.addColorStop(1, 'rgba(91,140,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, C.W, C.H);
  }

  function pill(x, y, w, h, c1, c2) {
    rr(x, y, w, h, h / 2);
    ctx.fillStyle = vgrad(y, y + h, c1, c2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();
  }

  function drawHUD() {
    pill(10, 10, 112, 38, 'rgba(255,200,60,0.20)', 'rgba(255,200,60,0.07)');
    emoji('🪙', 28, 29, 19);
    text(fmt(Math.floor(s.coins)), 42, 24, 17, '#ffe08a', 'left', '800');
    text('+' + C.income(s).toFixed(1) + '/s', 42, 40, 10, '#d9c27a', 'left', '600');

    pill(128, 10, 92, 38, 'rgba(91,140,255,0.22)', 'rgba(91,140,255,0.07)');
    text('TALAS', 174, 22, 9, '#9fb4ff', 'center', '700');
    text(String(s.wave), 174, 38, 18, '#ffffff', 'center', '800');

    pill(226, 10, 62, 38, 'rgba(255,90,90,0.22)', 'rgba(255,90,90,0.07)');
    emoji('❤️', 242, 29, 17);
    text(String(s.lives), 262, 29, 17, '#ffb3b3', 'left', '800');

    button('pause', 294, 10, 56, 38, { label: '⏸', size: 18, r: 19 });
  }

  function drawField() {
    const fx = 8, fy = 62, fw = 344, fh = 200;
    rr(fx, fy, fw, fh, 18);
    ctx.fillStyle = vgrad(fy, fy + fh, '#17352f', '#0e231f');
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.stroke();

    ctx.save();
    rr(fx, fy, fw, fh, 18);
    ctx.clip();
    // subtle dots
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 46; i++) {
      const px = (i * 97) % 340 + 12, py = (i * 53) % 190 + 68;
      ctx.beginPath(); ctx.arc(px, py, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2); ctx.fill();
    }
    // path
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    C.PATH.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 40; ctx.stroke();
    ctx.strokeStyle = '#2b3d5c'; ctx.lineWidth = 34; ctx.stroke();
    ctx.strokeStyle = '#34496d'; ctx.lineWidth = 28; ctx.stroke();
    ctx.setLineDash([6, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);

    // spawn arrows + castle
    text('»', 16, 92, 20, 'rgba(255,255,255,0.45)', 'center', '800');
    emoji('🏰', 344, 232, 28);

    // enemies
    const list = s.enemies.slice().sort((a, b) => a.y - b.y);
    for (const e of list) drawEnemy(e);
    ctx.restore();
  }

  function drawEnemy(e) {
    const size = e.kind === 'boss' ? 36 : e.kind === 'tank' ? 28 : 24;
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + size * 0.42, size * 0.38, 4, 0, 0, Math.PI * 2); ctx.fill();
    emoji(C.ENEMIES[e.kind].emoji, e.x, e.y, size);
    if (e.hit > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * e.hit / 0.09) + ')';
      ctx.beginPath(); ctx.arc(e.x, e.y, size * 0.42, 0, Math.PI * 2); ctx.fill();
    }
    if (e.slowT > 0) {
      ctx.strokeStyle = 'rgba(127,216,255,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, size * 0.55, 0, Math.PI * 2); ctx.stroke();
    }
    const bw = e.kind === 'boss' ? 42 : 26, bh = e.kind === 'boss' ? 6 : 4;
    const bx = e.x - bw / 2, by = e.y - size / 2 - 8;
    rr(bx, by, bw, bh, bh / 2); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    const ratio = Math.max(0, e.hp / e.max);
    if (ratio > 0) {
      rr(bx, by, Math.max(bh, bw * ratio), bh, bh / 2);
      ctx.fillStyle = ratio > 0.5 ? '#4be06a' : ratio > 0.25 ? '#ffc93c' : '#ff5a5a';
      ctx.fill();
    }
    // incoming damage (already fired shots in flight)
    const inc = Math.min(ratio, e.pend / e.max);
    if (inc > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      const w2 = bw * inc;
      ctx.fillRect(bx + Math.max(0, bw * ratio - w2), by, w2, bh);
    }
  }

  function drawStatus() {
    const y = 266, h = 36;
    const boss = C.bossNext(s) || C.isBossWave(s.wave) && s.queue.length > 0;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    rr(8, y, 180, h, 12);
    ctx.fillStyle = boss ? 'rgba(255,90,60,' + (0.16 + 0.16 * pulse) + ')' : 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = boss ? 'rgba(255,120,80,' + (0.5 + 0.4 * pulse) + ')' : 'rgba(255,255,255,0.10)';
    ctx.stroke();

    const sec = Math.max(0, Math.ceil(s.waveTimer));
    let l1;
    if (C.isBossWave(s.wave) && s.queue.length) l1 = '👹 BOSS napada!';
    else if (C.bossNext(s)) l1 = '⚠️ BOSS za ' + sec + 's';
    else l1 = 'Talas ' + (s.wave + 1) + ' za ' + sec + 's';
    text(l1, 18, y + 11, 13, boss ? '#ffb199' : '#ffffff', 'left', '800');

    // preview of next wave
    const pc = C.previewCounts(s);
    let px = 18;
    text('Dolazi:', px, y + 26, 10, '#8fa0c8', 'left', '600');
    px += 40;
    for (const k of ['grunt', 'runner', 'tank', 'boss']) {
      if (!pc[k]) continue;
      emoji(C.ENEMIES[k].emoji, px + 6, y + 26, 12);
      text('×' + pc[k], px + 15, y + 26, 10, '#dfe7ff', 'left', '700');
      px += k === 'boss' ? 30 : 36;
    }

    const can = s.waveTimer > 3 && !s.over;
    const eb = C.earlyBonus(s);
    button('call', 196, y + 2, 156, 32, {
      label: '▶ Pozovi' + (eb > 0 ? '  +' + eb + ' 🪙' : ''), size: 13, c1: can ? '#ffcf4a' : '#4a5270', c2: can ? '#e69a1a' : '#363c57',
      color: can ? '#2a1c00' : '#8c93ad', stroke: 'rgba(255,255,255,0.25)', r: 14
    });
  }

  function drawUnit(u, x, y, size, alpha, opts) {
    opts = opts || {};
    const T = C.TYPES[u.type];
    const tc = TIER_COL[u.tier - 1];
    const pulse = u.flash > 0 ? 1 + 0.09 * Math.min(1, u.flash / 0.14) : 1;
    const sz = size * pulse;
    ctx.save();
    ctx.globalAlpha = alpha || 1;
    const x0 = x - sz / 2, y0 = y - sz / 2;
    if (u.tier >= 4) { ctx.shadowColor = tc; ctx.shadowBlur = 12; }
    rr(x0, y0, sz, sz, 14);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + sz);
    g.addColorStop(0, T.c1); g.addColorStop(1, T.c2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = tc;
    ctx.stroke();
    // gloss
    rr(x0 + 3, y0 + 3, sz - 6, sz * 0.4, 11);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    emoji(T.emoji, x, y - 1, sz * 0.5);
    // meter: reload (attackers) or production (miner)
    const mx = x0 + 9, mw = sz - 18, my = y0 + 6;
    rr(mx, my, mw, 4, 2); ctx.fillStyle = 'rgba(0,0,0,0.40)'; ctx.fill();
    let prog;
    if (u.type === 'miner') prog = Math.min(1, u.acc || 0);
    else prog = u.cd <= 0 ? 1 : Math.max(0, Math.min(1, 1 - u.cd * T.rate));
    if (prog > 0.02) {
      rr(mx, my, Math.max(4, mw * prog), 4, 2);
      ctx.fillStyle = u.type === 'miner' ? '#7ff0e6' : (prog >= 1 ? '#ffffff' : 'rgba(255,255,255,0.75)');
      ctx.fill();
    }
    // tier pill
    rr(x - 14, y0 + sz - 9, 28, 15, 7.5);
    ctx.fillStyle = tc; ctx.fill();
    text('Lv' + u.tier, x, y0 + sz - 1.5, 10, '#111', 'center', '800');
    // muzzle flash
    if (!opts.noFlash && u.type !== 'miner' && u.flash > 0) {
      const fx = x + Math.cos(u.aim) * (sz / 2), fy = y + Math.sin(u.aim) * (sz / 2);
      const a = Math.min(1, u.flash / 0.14);
      const rg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 11);
      rg.addColorStop(0, 'rgba(255,255,255,' + a + ')');
      rg.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(fx, fy, 11, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawGrid(adv) {
    for (let i = 0; i < C.NSLOTS; i++) {
      const c = i % C.COLS, r = Math.floor(i / C.COLS);
      const sx = C.GRID_X + c * C.PITCH, sy = C.GRID_Y + r * C.PITCH;
      rr(sx, sy, C.CELL, C.CELL, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.stroke();
    }
    // advice highlight (merge)
    if (adv && adv.kind === 'merge' && !(drag && drag.moved)) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 5);
      for (const i of [adv.a, adv.b]) {
        const p = C.slotPos(i);
        rr(p[0] - 33, p[1] - 33, 66, 66, 16);
        ctx.strokeStyle = 'rgba(255,216,74,' + (0.4 + 0.5 * pulse) + ')';
        ctx.lineWidth = 2.5; ctx.stroke();
      }
    }
    // selection
    if (sel >= 0 && s.slots[sel]) {
      const p = C.slotPos(sel);
      rr(p[0] - 33, p[1] - 33, 66, 66, 16);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    }
    // drag merge targets
    if (drag && drag.moved) {
      for (let i = 0; i < C.NSLOTS; i++) {
        if (i !== drag.from && C.canMerge(s, drag.from, i)) {
          const p = C.slotPos(i);
          rr(p[0] - 34, p[1] - 34, 68, 68, 16);
          ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 3.5; ctx.stroke();
        }
      }
    }
    for (let i = 0; i < C.NSLOTS; i++) {
      const u = s.slots[i];
      if (!u || (drag && drag.moved && drag.from === i)) continue;
      const p = C.slotPos(i);
      drawUnit(u, p[0], p[1], 58, 1);
    }
  }

  function drawProjectiles() {
    for (const p of s.proj) {
      const ang = Math.atan2(p.ty - p.y, p.tx - p.x);
      const ux = Math.cos(ang), uy = Math.sin(ang);
      ctx.save();
      if (p.type === 'archer') {
        ctx.strokeStyle = '#eaffea'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x - ux * 12, p.y - uy * 12); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(p.x + ux * 4, p.y + uy * 4);
        ctx.lineTo(p.x - ux * 2 - uy * 3, p.y - uy * 2 + ux * 3);
        ctx.lineTo(p.x - ux * 2 + uy * 3, p.y - uy * 2 - ux * 3);
        ctx.fill();
      } else if (p.type === 'gunner') {
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x - ux * 8, p.y - uy * 8); ctx.lineTo(p.x, p.y); ctx.stroke();
      } else if (p.type === 'cannon') {
        const t = Math.max(0, Math.min(1, p.trav / Math.max(1, p.total)));
        const arc = Math.sin(Math.PI * t) * 26;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1b1b1f';
        ctx.beginPath(); ctx.arc(p.x, p.y - arc, 5.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ff9a4a'; ctx.lineWidth = 1.6; ctx.stroke();
      } else if (p.type === 'mage') {
        for (let k = 3; k >= 1; k--) {
          ctx.fillStyle = 'rgba(190,140,255,' + (0.14 * (4 - k)) + ')';
          ctx.beginPath(); ctx.arc(p.x - ux * k * 5, p.y - uy * k * 5, 5 - k * 0.6, 0, Math.PI * 2); ctx.fill();
        }
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7);
        rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#c9a2ff'); rg.addColorStop(1, 'rgba(160,100,255,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'sniper') {
        ctx.strokeStyle = 'rgba(255,243,176,0.55)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x - ux * 46, p.y - uy * 46); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(p.x - ux * 30, p.y - uy * 30); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawEffects() {
    for (const a of s.rings) {
      const k = a.t / a.life;
      ctx.globalAlpha = 1 - k;
      if (a.fill) {
        ctx.fillStyle = a.c; ctx.globalAlpha = 0.25 * (1 - k);
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r * (0.4 + 0.6 * k), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1 - k;
      }
      ctx.strokeStyle = a.c; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r * (0.35 + 0.65 * k), 0, Math.PI * 2); ctx.stroke();
    }
    for (const a of s.sparks) {
      const k = a.t / a.life;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = a.c; ctx.lineWidth = 2;
      const r = (a.big ? 7 : 4) + k * (a.big ? 12 : 7);
      for (let i = 0; i < 6; i++) {
        const an = i * Math.PI / 3 + a.x;
        ctx.beginPath();
        ctx.moveTo(a.x + Math.cos(an) * r * 0.5, a.y + Math.sin(an) * r * 0.5);
        ctx.lineTo(a.x + Math.cos(an) * r, a.y + Math.sin(an) * r);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (const a of s.texts) {
      const k = a.t / a.life;
      ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
      outlined(a.s, a.x, a.y - a.t * (a.small ? 18 : 30), a.size || 12, a.c || '#fff', a.small ? '700' : '800');
    }
    ctx.globalAlpha = 1;
  }

  function drawPanel(adv) {
    const x = 12, y = C.PANEL_Y, w = 336, h = C.PANEL_H;
    card(x, y, w, h, 14);
    const u = sel >= 0 ? s.slots[sel] : null;
    if (u) {
      const T = C.TYPES[u.type];
      const st = C.stats(u.type, u.tier);
      rr(x + 8, y + 8, 36, 36, 10);
      ctx.fillStyle = vgrad(y + 8, y + 44, T.c1, T.c2); ctx.fill();
      ctx.strokeStyle = TIER_COL[u.tier - 1]; ctx.lineWidth = 2; ctx.stroke();
      emoji(T.emoji, x + 26, y + 26, 20);
      text(T.name + ' · nivo ' + u.tier + (u.tier >= C.MAXTIER ? ' (max)' : ''), x + 54, y + 13, 13, '#fff', 'left', '800');
      let l2, l3;
      if (u.type === 'miner') {
        l2 = 'Proizvodi +' + (st.income * s.mode.income).toFixed(2) + ' 🪙/s';
        l3 = u.tier < C.MAXTIER ? 'Sljedeći nivo: +' + (C.stats('miner', u.tier + 1).income * s.mode.income).toFixed(2) + ' 🪙/s' : 'Maksimalni nivo';
      } else {
        l2 = 'Šteta ' + fmt(st.dmg) + ' · ' + T.rate + '/s · DPS ' + fmt(st.dps);
        const extra = T.splash ? 'Šteta po površini · ' : T.slow ? 'Usporava 40% · ' : T.target ? 'Cilja najjačeg · ' : '';
        l3 = extra + (u.tier < C.MAXTIER ? 'Sljedeći nivo DPS ' + fmt(C.stats(u.type, u.tier + 1).dps) : 'Maksimalni nivo');
      }
      text(l2, x + 54, y + 28, 11, '#dfe7ff', 'left', '600');
      text(l3, x + 54, y + 42, 10, '#8fa0c8', 'left', '600');
      button('sell', x + w - 76, y + 8, 68, 36, { r: 11, c1: 'rgba(255,90,90,0.35)', c2: 'rgba(255,90,90,0.15)', stroke: 'rgba(255,120,120,0.5)' });
      text('Prodaj', x + w - 42, y + 20, 12, '#ffd0d0', 'center', '800');
      text('+' + Math.floor(u.val * 0.5) + ' 🪙', x + w - 42, y + 35, 11, '#ffe08a', 'center', '700');
    } else {
      emoji('💡', x + 22, y + 26, 20);
      const lines = wrap(adv.text, w - 56, 11.5, '600').slice(0, 3);
      const startY = y + h / 2 - (lines.length - 1) * 7;
      lines.forEach((l, i) => text(l, x + 44, startY + i * 14, 11.5, adv.kind === 'buy' ? '#ffffff' : '#ffe08a', 'left', '600'));
    }
  }

  function drawShop(adv) {
    const selling = drag && drag.moved && drag.y >= C.SHOP_Y - 8;
    C.TYPE_KEYS.forEach((k, i) => {
      const T = C.TYPES[k];
      const r = C.shopRect(i);
      const cst = C.cost(s, k);
      const ok = s.coins >= cst && !s.over;
      const rec = adv.kind === 'buy' && adv.type === k;
      const pulse = 0.5 + 0.5 * Math.sin(clock * 4);
      button('buy:' + k, r.x, r.y, r.w, r.h, {
        r: 14, c1: selling ? '#5a2430' : ok ? T.c1 : '#2a3150', c2: selling ? '#3b1721' : ok ? T.c2 : '#1f2540',
        stroke: rec ? 'rgba(255,216,74,' + (0.55 + 0.45 * pulse) + ')' : ok ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.10)'
      });
      ctx.globalAlpha = ok ? 1 : 0.6;
      emoji(T.emoji, r.x + 22, r.y + 26, 26);
      text(T.name, r.x + 42, r.y + 14, 12, '#fff', 'left', '800');
      text('🪙 ' + cst, r.x + 42, r.y + 30, 14, '#ffe08a', 'left', '800');
      const tag = k === 'miner' ? '+' + (T.income * s.mode.income).toFixed(2) + ' 🪙/s' : 'DPS ' + fmt(T.dmg * T.rate);
      text(tag, r.x + 42, r.y + 44, 9.5, 'rgba(255,255,255,0.78)', 'left', '700');
      ctx.globalAlpha = 1;
      if (rec) emoji('⭐', r.x + r.w - 13, r.y + r.h - 13, 12);
    });
    if (selling) {
      const u = s.slots[drag.from];
      const y0 = C.SHOP_Y - 4, h = 2 * C.SHOP_BH + 14;
      rr(8, y0, 344, h, 16);
      ctx.fillStyle = 'rgba(160,30,50,0.78)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,140,140,0.8)'; ctx.lineWidth = 2; ctx.stroke();
      text('PRODAJ  +' + Math.floor(u.val * 0.5) + ' 🪙', C.W / 2, y0 + h / 2, 20, '#fff', 'center', '800');
    }
  }

  function drawAnnounce() {
    const a = s.announce;
    if (!a) return;
    const k = a.t / a.life;
    const pop = Math.min(1, a.t / 0.22);
    const ease = 1 - Math.pow(1 - pop, 3);
    const alpha = k > 0.8 ? (1 - k) / 0.2 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(C.W / 2, 160);
    ctx.scale(0.6 + 0.4 * ease, 0.6 + 0.4 * ease);
    rr(-160, -34, 320, 68, 18);
    ctx.fillStyle = 'rgba(12,16,34,0.88)'; ctx.fill();
    ctx.strokeStyle = a.color; ctx.lineWidth = 2.5; ctx.stroke();
    text(a.text, 0, -10, 19, a.color, 'center', '900');
    text(a.sub, 0, 17, 11.5, '#dfe7ff', 'center', '600');
    ctx.restore();
  }

  function drawToast() {
    if (toast.t <= 0) return;
    ctx.globalAlpha = Math.min(1, toast.t * 2);
    ctx.font = '700 12px ' + FONT;
    const w = ctx.measureText(toast.msg).width + 28;
    rr(C.W / 2 - w / 2, 236, w, 26, 13);
    ctx.fillStyle = 'rgba(8,12,28,0.88)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
    text(toast.msg, C.W / 2, 249, 12, '#fff', 'center', '700');
    ctx.globalAlpha = 1;
  }

  function drawGame() {
    drawBackground();
    drawHUD();
    drawField();
    drawStatus();
    const adv = C.advise(s);
    drawGrid(adv);
    drawProjectiles();
    drawEffects();
    drawPanel(adv);
    drawShop(adv);
    if (drag && drag.moved && s.slots[drag.from]) drawUnit(s.slots[drag.from], drag.x, drag.y - 22, 64, 0.92, { noFlash: true });
    drawAnnounce();
    drawToast();
    if (s.hurt > 0) {
      const a = 0.35 * Math.min(1, s.hurt / 0.4);
      const g = ctx.createRadialGradient(C.W / 2, C.H / 2, 200, C.W / 2, C.H / 2, 480);
      g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, 'rgba(255,40,40,' + a + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, C.W, C.H);
    }
  }

  // ---------- screens ----------
  function dim(a) { ctx.fillStyle = 'rgba(6,9,22,' + a + ')'; ctx.fillRect(0, 0, C.W, C.H); }

  function titleText(y) {
    ctx.font = '900 46px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(60, 0, 300, 0);
    g.addColorStop(0, '#6ee7ff'); g.addColorStop(0.5, '#8b9dff'); g.addColorStop(1, '#d28bff');
    ctx.fillStyle = g;
    ctx.fillText('MERGE', C.W / 2, y);
    ctx.fillText('DEFENSE', C.W / 2, y + 46);
  }

  function drawMenu() {
    drawBackground();
    titleText(92);
    text('Spajaj vojnike. Brani put. Pobijedi bosa.', C.W / 2, 176, 12.5, '#9fb0d8', 'center', '600');
    text('Izaberi težinu', C.W / 2, 214, 13, '#dfe7ff', 'center', '800');
    C.MODE_KEYS.forEach((k, i) => {
      const m = C.MODES[k];
      const y = 234 + i * 104;
      const col = MODE_COL[k];
      button('mode:' + k, 20, y, 320, 92, { r: 20, c1: 'rgba(255,255,255,0.09)', c2: 'rgba(255,255,255,0.03)', stroke: col + 'aa' });
      rr(20, y, 6, 92, 3);
      ctx.fillStyle = col; ctx.fill();
      emoji(m.emoji, 62, y + 46, 38);
      text(m.name, 100, y + 28, 20, '#fff', 'left', '900');
      const hpTxt = m.hp < 1 ? 'slabiji neprijatelji' : m.hp > 1 ? 'jači neprijatelji' : 'normalni neprijatelji';
      text(m.coins + ' 🪙 · ' + m.lives + ' ❤️ · ' + hpTxt, 100, y + 52, 11.5, '#b6c3e6', 'left', '600');
      text(k === 'easy' ? 'Više novčića i života' : k === 'hard' ? 'Malo novčića, malo života' : 'Uravnotežena igra', 100, y + 70, 11, '#8493bd', 'left', '600');
      text('REKORD', 318, y + 30, 9, '#8493bd', 'right', '700');
      text(best[k] ? 'Talas ' + best[k] : '—', 318, y + 50, 15, col, 'right', '800');
    });
    button('guide', 70, 560, 220, 44, { label: '📖  Vodič kroz jedinice', size: 14, r: 22 });
    text('Radi bez interneta · v2', C.W / 2, 640, 10.5, '#5d6a92', 'center', '600');
  }

  function drawGuide() {
    drawBackground();
    text('Vodič', C.W / 2, 34, 24, '#fff', 'center', '900');
    const tips = [
      '1. Kupi vojnike dolje. Rudar ⛏️ ne puca, ali proizvodi novčiće 🪙.',
      '2. Povuci dva ISTA vojnika (isti nivo) jedan na drugog — spoje se u jačeg.',
      '3. Tapni vojnika za statistiku. Povuci ga dolje na dugmad za prodaju.',
      '4. Svaki 10. talas je 👹 BOSS. Upozorenje stiže talas ranije.',
      '5. ⭐ na dugmetu i 💡 savjet pokazuju šta se trenutno najviše isplati.'
    ];
    let y = 66;
    for (const t of tips) {
      const lines = wrap(t, 330, 11.5, '600');
      for (const l of lines) { text(l, 16, y, 11.5, '#dfe7ff', 'left', '600'); y += 15; }
      y += 3;
    }
    y += 4;
    C.TYPE_KEYS.forEach((k, i) => {
      const T = C.TYPES[k];
      const ry = y + i * 66;
      card(10, ry, 340, 61, 14);
      rr(18, ry + 10, 40, 40, 11);
      ctx.fillStyle = vgrad(ry + 10, ry + 50, T.c1, T.c2); ctx.fill();
      emoji(T.emoji, 38, ry + 30, 22);
      text(T.name, 68, ry + 11, 13, '#fff', 'left', '800');
      text('🪙 ' + T.cost, 342, ry + 11, 12, '#ffe08a', 'right', '800');
      const stat = k === 'miner' ? 'Proizvodi +' + T.income + ' 🪙/s' : 'Šteta ' + T.dmg + ' · ' + T.rate + '/s · DPS ' + fmt(T.dmg * T.rate);
      text(stat, 68, ry + 25, 10.5, '#9fb4ff', 'left', '700');
      text(T.desc, 68, ry + 38, 10, '#a9b6dc', 'left', '500');
      text('Najbolje: ' + T.best.toLowerCase(), 68, ry + 51, 10, '#7fe3b0', 'left', '600');
    });
    const first = load('md2_seen', '0') !== '1';
    button('closeGuide', 70, 676, 220, 46, { label: first ? 'Razumijem, igraj!' : 'Zatvori', size: 15, r: 23, c1: '#6aa0ff', c2: '#4a6fe0', color: '#fff' });
  }

  function drawPause() {
    drawGame();
    dim(0.72);
    card(40, 190, 280, 330, 22, 'rgba(18,24,48,0.95)', 'rgba(255,255,255,0.14)');
    text('PAUZA', C.W / 2, 228, 22, '#fff', 'center', '900');
    text(C.MODES[modeKey].emoji + ' ' + C.MODES[modeKey].name + ' · Talas ' + s.wave, C.W / 2, 256, 12, '#9fb0d8', 'center', '600');
    button('resume', 62, 280, 236, 46, { label: '▶  Nastavi', size: 15, r: 23, c1: '#6aa0ff', c2: '#4a6fe0' });
    button('guide', 62, 336, 236, 42, { label: '📖  Vodič', size: 14, r: 21 });
    button('restart', 62, 388, 236, 42, { label: '↻  Počni ispočetka', size: 14, r: 21 });
    button('menu', 62, 440, 236, 42, { label: '☰  Glavni meni', size: 14, r: 21 });
  }

  function drawOver() {
    drawGame();
    dim(0.78);
    card(36, 170, 288, 360, 24, 'rgba(18,24,48,0.96)', 'rgba(255,255,255,0.14)');
    text('KRAJ IGRE', C.W / 2, 214, 28, '#ff7b7b', 'center', '900');
    text(C.MODES[modeKey].emoji + ' ' + C.MODES[modeKey].name, C.W / 2, 244, 12, '#9fb0d8', 'center', '700');
    text(String(s.wave), C.W / 2, 306, 56, '#fff', 'center', '900');
    text('TALAS', C.W / 2, 346, 11, '#8493bd', 'center', '700');
    if (newBest) text('🏆 Novi rekord!', C.W / 2, 376, 15, '#ffd84a', 'center', '800');
    else text('Rekord: talas ' + best[modeKey], C.W / 2, 376, 13, '#ffe08a', 'center', '700');
    text('Ubijeno neprijatelja: ' + s.kills, C.W / 2, 402, 12, '#b6c3e6', 'center', '600');
    button('again', 60, 430, 240, 44, { label: '↻  Igraj ponovo', size: 15, r: 22, c1: '#6aa0ff', c2: '#4a6fe0' });
    button('menu', 60, 482, 240, 36, { label: '☰  Meni', size: 13, r: 18 });
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1022';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, C.W, C.H); ctx.clip();
    buttons = [];
    if (scene === 'menu') drawMenu();
    else if (scene === 'guide') drawGuide();
    else if (scene === 'pause') drawPause();
    else if (scene === 'over') drawOver();
    else drawGame();
    ctx.restore();
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    if (toast.t > 0) toast.t -= dt;
    if (scene === 'play' && !hidden) {
      C.update(s, dt);
      if (sel >= 0 && !s.slots[sel]) sel = -1;
      if (s.wave > best[modeKey]) { best[modeKey] = s.wave; save('md2_best_' + modeKey, String(s.wave)); newBest = s.wave > 1; }
      if (s.over) { scene = 'over'; overAt = now; drag = null; }
    }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
