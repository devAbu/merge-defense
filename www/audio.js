// Merge Defense - sound effects + music, all synthesized with Web Audio (no files, works offline)
(function (root) {
  'use strict';

  const store = {
    get: function (k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  let ctx = null, master = null, sfxBus = null, musBus = null, delay = null, noiseBuf = null;
  let sfxOn = store.get('md_sfx', '1') === '1';
  let musicOn = store.get('md_music', '1') === '1';
  let mode = 'off';           // 'off' | 'menu' | 'play' | 'boss'
  let ducked = false;
  let timer = null, nextTime = 0, step = 0;
  let active = 0;             // concurrent sfx voices
  const lastShot = {};

  const midi = function (n) { return 440 * Math.pow(2, (n - 69) / 12); };

  function init() {
    if (ctx) return true;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 1 : 0; sfxBus.connect(master);
    musBus = ctx.createGain(); musBus.gain.value = musicOn ? 0.32 : 0; musBus.connect(master);
    // soft echo for the music
    delay = ctx.createDelay(1); delay.delayTime.value = 0.29;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dl = ctx.createGain(); dl.gain.value = 0.35;
    delay.connect(fb); fb.connect(delay); delay.connect(dl); dl.connect(musBus);
    // 1s of white noise
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // ---------- synth primitives ----------
  function tone(o) {
    // o: {type,f0,f1,t,dur,gain,attack,dest,detune}
    const t = o.t !== undefined ? o.t : ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const a = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    let out = g;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp;
      g.connect(f); out = f;
    }
    out.connect(o.dest || sfxBus);
    osc.start(t); osc.stop(t + o.dur + 0.05);
    return osc;
  }
  function noise(o) {
    // o: {t,dur,gain,filter,freq,q,dest}
    const t = o.t !== undefined ? o.t : ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loopStart = Math.random() * 0.5; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass'; f.frequency.value = o.freq || 1000; f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
  }
  function voice(fn) {
    if (active > 16) return;
    active++;
    fn();
    setTimeout(function () { active--; }, 400);
  }

  // ---------- sound effects ----------
  const SFX = {
    click: function () { tone({ type: 'triangle', f0: 1400, f1: 1000, dur: 0.04, gain: 0.07 }); },
    error: function () { tone({ type: 'square', f0: 170, f1: 120, dur: 0.14, gain: 0.07, lp: 900 }); },
    buy: function () {
      const t = ctx.currentTime;
      tone({ type: 'triangle', f0: midi(72), dur: 0.1, gain: 0.12, t: t });
      tone({ type: 'triangle', f0: midi(79), dur: 0.16, gain: 0.12, t: t + 0.07 });
    },
    sell: function () {
      const t = ctx.currentTime;
      [84, 88, 91].forEach(function (n, i) { tone({ type: 'sine', f0: midi(n), dur: 0.12, gain: 0.09, t: t + i * 0.05 }); });
    },
    merge: function (e) {
      const t = ctx.currentTime;
      const base = 60 + Math.min(10, ((e && e.tier) || 2) * 1.5);
      [0, 4, 7, 12].forEach(function (n, i) {
        tone({ type: 'triangle', f0: midi(base + n), dur: 0.22, gain: 0.13, t: t + i * 0.06 });
        tone({ type: 'sine', f0: midi(base + n + 12), dur: 0.18, gain: 0.05, t: t + i * 0.06 });
      });
      noise({ t: t, dur: 0.18, gain: 0.05, filter: 'highpass', freq: 5000 });
    },
    coin: function () { tone({ type: 'sine', f0: 1320, f1: 1760, dur: 0.09, gain: 0.05 }); },
    kill: function (e) {
      if (e && e.boss) {
        tone({ type: 'sawtooth', f0: 220, f1: 40, dur: 0.9, gain: 0.2, lp: 800 });
        noise({ dur: 0.7, gain: 0.18, filter: 'lowpass', freq: 900 });
        return;
      }
      tone({ type: 'sine', f0: 880, f1: 1500, dur: 0.07, gain: 0.05 });
    },
    leak: function () {
      tone({ type: 'sine', f0: 110, f1: 45, dur: 0.3, gain: 0.25 });
      noise({ dur: 0.2, gain: 0.12, filter: 'lowpass', freq: 600 });
    },
    wave: function () {
      const t = ctx.currentTime;
      tone({ type: 'sawtooth', f0: midi(55), dur: 0.35, gain: 0.07, lp: 900, attack: 0.04, t: t });
      tone({ type: 'sawtooth', f0: midi(62), dur: 0.35, gain: 0.07, lp: 900, attack: 0.04, t: t + 0.18 });
    },
    bossWarn: function () {
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        tone({ type: 'square', f0: i % 2 ? 520 : 390, dur: 0.22, gain: 0.07, lp: 1400, t: t + i * 0.26 });
      }
    },
    boss: function () {
      const t = ctx.currentTime;
      tone({ type: 'sawtooth', f0: 70, f1: 48, dur: 1.4, gain: 0.2, lp: 500, attack: 0.1, t: t });
      tone({ type: 'sawtooth', f0: 73, f1: 50, dur: 1.4, gain: 0.16, lp: 500, attack: 0.1, t: t, detune: 12 });
      noise({ t: t, dur: 1.0, gain: 0.08, filter: 'lowpass', freq: 400 });
    },
    bossSpawn: function () { SFX.boss(); },
    auto: function () {
      const t = ctx.currentTime;
      tone({ type: 'sawtooth', f0: 300, f1: 1200, dur: 0.35, gain: 0.08, lp: 3000, t: t });
      tone({ type: 'triangle', f0: midi(84), dur: 0.25, gain: 0.1, t: t + 0.3 });
    },
    ach: function () {
      const t = ctx.currentTime;
      [76, 83, 88].forEach(function (n, i) { tone({ type: 'triangle', f0: midi(n), dur: 0.2, gain: 0.08, t: t + i * 0.08 }); });
      noise({ t: t, dur: 0.3, gain: 0.03, filter: 'highpass', freq: 6000 });
    },
    chest: function () {
      const t = ctx.currentTime;
      [60, 64, 67, 72, 76].forEach(function (n, i) { tone({ type: 'triangle', f0: midi(n), dur: 0.3, gain: 0.11, t: t + i * 0.08 }); });
      noise({ t: t + 0.3, dur: 0.4, gain: 0.05, filter: 'highpass', freq: 5000 });
    },
    over: function () {
      const t = ctx.currentTime;
      [69, 65, 62, 57].forEach(function (n, i) { tone({ type: 'triangle', f0: midi(n), dur: 0.45, gain: 0.12, t: t + i * 0.28, lp: 1500 }); });
    },
    shot: function (e) {
      const type = e && e.type;
      const now = ctx.currentTime;
      const gap = type === 'gunner' ? 0.09 : 0.05;
      if (lastShot[type] && now - lastShot[type] < gap) return;
      lastShot[type] = now;
      if (type === 'archer') {
        tone({ type: 'triangle', f0: 700, f1: 280, dur: 0.07, gain: 0.07 });
        noise({ dur: 0.05, gain: 0.03, filter: 'highpass', freq: 4000 });
      } else if (type === 'gunner') {
        noise({ dur: 0.04, gain: 0.05, filter: 'highpass', freq: 2500 });
        tone({ type: 'square', f0: 260, f1: 120, dur: 0.04, gain: 0.025, lp: 1500 });
      } else if (type === 'cannon') {
        tone({ type: 'sine', f0: 130, f1: 45, dur: 0.25, gain: 0.22 });
        noise({ dur: 0.18, gain: 0.1, filter: 'lowpass', freq: 700 });
      } else if (type === 'mage') {
        tone({ type: 'sine', f0: 700, f1: 1300, dur: 0.16, gain: 0.07 });
        tone({ type: 'triangle', f0: 1400, f1: 900, dur: 0.12, gain: 0.03, detune: 9 });
      } else if (type === 'sniper') {
        noise({ dur: 0.12, gain: 0.16, filter: 'bandpass', freq: 2200, q: 0.8 });
        tone({ type: 'sine', f0: 240, f1: 60, dur: 0.2, gain: 0.16 });
      }
    }
  };

  // ---------- music (procedural loop, 4 bars, A minor) ----------
  const BPM = 104;
  const STEP = 60 / BPM / 4;                 // 16th note
  const PROG = [
    { root: 45, tones: [57, 60, 64] },       // Am
    { root: 41, tones: [53, 57, 60] },       // F
    { root: 48, tones: [55, 60, 64] },       // C
    { root: 43, tones: [55, 59, 62] }        // G
  ];
  // melody per step (0 = rest), 64 steps
  const MEL = (function () {
    const m = new Array(64).fill(0);
    const put = function (arr) { arr.forEach(function (p) { m[p[0]] = p[1]; }); };
    put([[0, 76], [3, 74], [6, 72],
      [16, 72], [19, 74], [22, 76], [24, 77],
      [32, 79], [35, 76], [38, 74], [40, 72],
      [48, 74], [51, 71], [54, 74], [56, 76], [60, 74]]);
    return m;
  })();

  function schedStep(st, t) {
    const intensity = mode === 'menu' ? 0 : mode === 'boss' ? 2 : 1;
    const bar = Math.floor(st / 16);
    const inBar = st % 16;
    const ch = PROG[bar];

    // pad: once per bar
    if (inBar === 0) {
      ch.tones.forEach(function (n, i) {
        const o1 = tone({ type: 'sawtooth', f0: midi(n), dur: STEP * 16 + 0.5, gain: intensity === 0 ? 0.035 : 0.022, attack: 0.5, t: t, dest: musBus, lp: 650, detune: i * 4 - 4 });
        void o1;
      });
    }
    // bass
    const bassPat = intensity === 0 ? [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] :
      intensity === 1 ? [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0] : [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1];
    if (bassPat[inBar]) {
      tone({ type: 'triangle', f0: midi(ch.root), dur: STEP * (intensity === 0 ? 8 : 1.6), gain: 0.16, t: t, dest: musBus, lp: 500 });
    }
    // drums
    if (intensity >= 1) {
      if (inBar % 4 === 0) tone({ type: 'sine', f0: 140, f1: 45, dur: 0.16, gain: 0.3, t: t, dest: musBus });
      if (inBar === 4 || inBar === 12) noise({ t: t, dur: 0.12, gain: 0.07, filter: 'bandpass', freq: 1800, q: 0.9, dest: musBus });
      const hat = intensity === 2 ? true : inBar % 4 === 2;
      if (hat) noise({ t: t, dur: 0.035, gain: intensity === 2 ? 0.03 : 0.04, filter: 'highpass', freq: 7000, dest: musBus });
    }
    // arp
    const arpEvery = intensity === 0 ? 4 : 2;
    if (inBar % arpEvery === 0) {
      const k = (inBar / arpEvery) % 4;
      const note = ch.tones[[0, 1, 2, 1][k]] + (intensity === 2 ? 24 : 12);
      const dest = ctx.createGain(); dest.gain.value = 1;
      dest.connect(musBus); dest.connect(delay);
      tone({ type: 'triangle', f0: midi(note), dur: STEP * 1.8, gain: intensity === 0 ? 0.05 : 0.06, t: t, dest: dest, lp: 2200 });
    }
    // melody
    if (intensity >= 1 && MEL[st]) {
      const dest = ctx.createGain(); dest.gain.value = 1;
      dest.connect(musBus); dest.connect(delay);
      tone({ type: 'sine', f0: midi(MEL[st]), dur: STEP * 3, gain: 0.09, t: t, dest: dest, attack: 0.02 });
      tone({ type: 'triangle', f0: midi(MEL[st] + 12), dur: STEP * 2, gain: 0.02, t: t, dest: dest });
    }
  }

  function tick() {
    if (!ctx || !musicOn || mode === 'off' || ctx.state !== 'running') return;
    while (nextTime < ctx.currentTime + 0.3) {
      schedStep(step, nextTime);
      nextTime += STEP;
      step = (step + 1) % 64;
    }
  }
  function startMusic() {
    if (!ctx || timer) return;
    nextTime = ctx.currentTime + 0.08;
    timer = setInterval(tick, 50);
  }
  function stopMusic() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function applyBusGains() {
    if (!ctx) return;
    const t = ctx.currentTime;
    sfxBus.gain.cancelScheduledValues(t); sfxBus.gain.setTargetAtTime(sfxOn ? 1 : 0, t, 0.03);
    musBus.gain.cancelScheduledValues(t); musBus.gain.setTargetAtTime(musicOn ? (ducked ? 0.12 : 0.32) : 0, t, 0.15);
  }
  function refreshMusic() {
    if (!ctx) return;
    if (musicOn && mode !== 'off') startMusic(); else stopMusic();
    applyBusGains();
  }

  const Snd = {
    // call from a user gesture (first tap)
    unlock: function () {
      if (!init()) return;
      if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) { /* ignore */ } }
      refreshMusic();
    },
    play: function (name, e) {
      if (!sfxOn || !ctx || ctx.state !== 'running') return;
      const f = SFX[name];
      if (!f) return;
      if (name === 'shot') { voice(function () { f(e); }); return; }
      f(e);
    },
    setMode: function (m) {
      if (m === mode) return;
      mode = m;
      refreshMusic();
    },
    duck: function (d) { if (d !== ducked) { ducked = d; applyBusGains(); } },
    suspend: function () { if (ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) { /* ignore */ } } },
    resume: function () { if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } } },
    toggleSfx: function () {
      sfxOn = !sfxOn; store.set('md_sfx', sfxOn ? '1' : '0'); applyBusGains();
      if (sfxOn) Snd.play('click');
      return sfxOn;
    },
    toggleMusic: function () {
      musicOn = !musicOn; store.set('md_music', musicOn ? '1' : '0'); refreshMusic();
      return musicOn;
    },
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; }
  };
  root.Snd = Snd;
})(this);
