/* Reno Utopia — a stick-figure banana brawler.
 * Plain canvas + Web Audio, no dependencies. Works on desktop and phones,
 * and installs as an app (see manifest.webmanifest + sw.js). */
'use strict';
(function () {
  const { ZONES, SOLID } = window.RU_DATA;
  const TILE = 32;
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  let ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, zoom = 1;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const DEBUG = /debug/.test(location.search);

  // ---------------------------------------------------------------- utils
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dst = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + (s || 0) * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ---------------------------------------------------------------- audio
  const Sfx = {
    ac: null, master: null, nb: null, muted: store.get('ru_muted', false), lastScream: 0,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ac.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ac.destination);
      } catch (e) { this.ac = null; }
    },
    setMuted(m) { this.muted = m; store.set('ru_muted', m); if (this.master) this.master.gain.value = m ? 0 : 0.5; },
    tone(f, d, type, v, f2, delay) {
      const ac = this.ac; if (!ac) return;
      const t = ac.currentTime + (delay || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(f2, 20), t + d);
      g.gain.setValueAtTime(v || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.02);
    },
    noise(d, v, freq, type, delay) {
      const ac = this.ac; if (!ac) return;
      if (!this.nb) {
        const len = ac.sampleRate * 2, b = ac.createBuffer(1, len, ac.sampleRate), ch = b.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        this.nb = b;
      }
      const t = ac.currentTime + (delay || 0);
      const s = ac.createBufferSource(); s.buffer = this.nb;
      const f = ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 1000;
      const g = ac.createGain(); g.gain.setValueAtTime(v || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + d + 0.02);
    },
    throw() { this.noise(0.08, 0.07, 2500, 'bandpass'); },
    hit() { this.tone(240, 0.08, 'square', 0.07, 110); this.noise(0.05, 0.08, 900); },
    scream() {
      const ac = this.ac; if (!ac) return;
      const t = ac.currentTime; if (t - this.lastScream < 0.2) return; this.lastScream = t;
      const o = ac.createOscillator(); o.type = 'sawtooth';
      const base = rand(450, 950);
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * 1.35, t + 0.15);
      o.frequency.exponentialRampToValueAtTime(base * 0.3, t + 1.1);
      const lfo = ac.createOscillator(); lfo.frequency.value = rand(8, 15);
      const lg = ac.createGain(); lg.gain.value = base * 0.06; lfo.connect(lg); lg.connect(o.frequency);
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.2;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.11, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t); lfo.start(t); o.stop(t + 1.2); lfo.stop(t + 1.2);
      this.noise(1.0, 0.07, 700, 'lowpass'); // the crackle of the flames
    },
    fart() { this.tone(75, 0.7, 'sawtooth', 0.2, 42); this.noise(0.7, 0.25, 260); this.noise(0.5, 0.12, 1400, 'bandpass', 0.15); },
    shatter() { this.noise(0.25, 0.22, 4000, 'highpass'); this.tone(2600, 0.1, 'triangle', 0.04, 1900); },
    splat() { this.noise(0.12, 0.12, 500); },
    hurt() { this.tone(320, 0.22, 'square', 0.12, 80); },
    helper() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, 'square', 0.06, null, i * 0.07)); },
    door() { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.1, null, i * 0.1)); },
    boss() { this.tone(110, 0.9, 'sawtooth', 0.16, 55); this.tone(82, 1.1, 'square', 0.1, 40, 0.25); },
    deny() { this.tone(180, 0.12, 'square', 0.08); this.tone(120, 0.2, 'square', 0.08, null, 0.12); },
    puff() { this.noise(0.3, 0.05, 600); },
    swing() { this.noise(0.12, 0.08, 1800, 'bandpass'); },
    lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.12, null, i * 0.22)); },
    win() { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.2, 'square', 0.07, null, i * 0.13)); },
  };

  // ---------------------------------------------------------------- game definitions
  const CLASSES = {
    newbie: { name: 'The Newcomer', blurb: 'Fresh off intake. Balanced in every way. Infinite bananas.', hp: 5, speed: 150, rate: 1, shirt: '#3a7bd5', weapons: ['banana'], look: 'backpack', stats: { POWER: 2, SPEED: 2, TOUGH: 2 } },
    speedy: { name: 'Speedy Pete', blurb: 'Fastest feet on campus. Quick arm, thin skin.', hp: 4, speed: 200, rate: 0.72, shirt: '#27ae60', weapons: ['banana'], look: 'headband', stats: { POWER: 2, SPEED: 4, TOUGH: 1 } },
    bev: { name: 'Big Momma Bev', blurb: 'Throws the whole bunch: three bananas at once. Hard to knock down.', hp: 7, speed: 128, rate: 1, shirt: '#c0392b', weapons: ['bunch'], look: 'bun', stats: { POWER: 3, SPEED: 1, TOUGH: 4 } },
    ralph: { name: 'Ralph the Inhabitant', blurb: 'Been here longer than the staff. Bananas, eggs, beer bottles, flaming cigarettes — and he can turn around and blow fire out his backside.', hp: 9, speed: 170, rate: 0.9, shirt: '#7a6236', weapons: ['banana', 'egg', 'bottle', 'cig'], special: true, look: 'ralph', over: true, stats: { POWER: 5, SPEED: 3, TOUGH: 5 } },
  };

  const WEAPONS = {
    banana: { name: 'BANANA', icon: '🍌', cd: 0.3 },
    bunch: { name: 'BUNCH', icon: '🍌', cd: 0.46 },
    egg: { name: 'EGGS', icon: '🥚', cd: 0.13 },
    bottle: { name: 'BEER', icon: '🍺', cd: 0.45 },
    cig: { name: 'SMOKE', icon: '🚬', cd: 0.5 },
  };

  // ranks, lowest to highest
  const ENEMIES = {
    f: { role: 'FACILITY ASST', hp: 2, speed: 72, vest: '#f4d03f', attack: 'melee', range: 34, cd: 1.1, pts: 1, r: 11,
      lines: ['Lights out!', 'No food in the dorm!', 'Where\'s your wristband?', 'I just mopped that!', 'Bed check!'] },
    m: { role: 'MAINTENANCE', hp: 3, speed: 62, vest: '#e67e22', attack: 'wrench', range: 290, cd: 1.9, pts: 2, r: 11,
      lines: ['Put in a work order.', 'That\'s not my department.', 'It was working yesterday.', 'Parts are on backorder.'] },
    c: { role: 'CASEWORKER', hp: 3, speed: 66, vest: '#8e44ad', attack: 'notebook', range: 300, cd: 0.85, pts: 3, r: 11,
      lines: ['Did you sign your plan?', 'Where\'s your ID?', 'The waitlist is 18 months.', 'I\'ll put it in my notes.', 'Fill this out first.'] },
    s: { role: 'SUPERVISOR', hp: 5, speed: 56, vest: '#e74c3c', attack: 'beebee', range: 300, cd: 1.45, pts: 4, r: 11,
      lines: ['YOU. Yes, YOU.', 'That\'s a write-up.', '24-hour trespass!', 'I\'m not asking again.'] },
    a: { role: 'ASST ADMIN', hp: 6, speed: 82, vest: '#16a085', attack: 'ruler', range: 42, cd: 0.9, pts: 5, r: 11,
      lines: ['*smack* *smack*', 'Per the memo...', 'We\'ll circle back.', 'Is this on the agenda?'] },
    A: { role: 'ADMINISTRATOR', hp: 8, speed: 50, vest: '#2c3e50', attack: 'office', range: 320, cd: 1.0, pts: 6, r: 12,
      lines: ['Per policy.', 'Submit it in writing.', 'That\'s above my pay grade.', 'Have you tried the portal?'] },
    K: { role: 'THE BIG KAHUNA', hp: 170, speed: 46, vest: '#000', attack: 'boss', range: 9999, cd: 1.6, pts: 50, r: 26,
      lines: ['Your bed has been reassigned.', 'This is a NO-TOLERANCE campus!', 'Housing First... eventually.', 'Have you filled out form 27-B?', 'We\'re at capacity.', 'Funding is very tight right now.'] },
  };
  const BURN_LINES = ['AAAAAGH!', 'MY PTO!', 'I\'M CALLING HR!', 'NOT MY LANYARD!', 'THIS GOES IN MY NOTES!', 'WRITE IT UP!!', 'EEEEEEE!', 'I\'M ON MY BREAK!', 'MY PENSION!', 'THIS IS A HIPAA VIOLATION!'];
  const HELPER_NAMES = ['Lil Mike', 'Tina', 'Big Earl', 'Smokey', 'Doc', 'Cricket', 'Rooster', 'Patches', 'Junebug', 'Tex', 'Sunny', 'Moose', 'Ghost', 'Peaches'];
  const SHIRTS = ['#e84393', '#00b894', '#fdcb6e', '#6c5ce7', '#d63031', '#0984e3', '#fab1a0', '#55efc4', '#a29bfe', '#ff7675'];
  const MAX_HELPERS = 8;
  const NEEDED_FOR_BOSS = 5;

  // ---------------------------------------------------------------- run + zone state
  let state = 'title';
  let G = null; // run: lives, points, helpers...
  let Z = null; // current zone
  let P = null; // player
  let shake = 0;
  let lastT = 0;

  function newRun(cls) {
    const def = CLASSES[cls];
    G = { cls, def, lives: 3, points: 0, prog: 0, kills: 0, hits: 0, time: 0, weapon: 0, helpers: [], usedNames: [] };
    P = makePlayer(def);
    loadZone(0);
    setState('play');
  }

  function makePlayer(def) {
    return { x: 0, y: 0, r: 11, hp: def.hp, maxHp: def.hp, speed: def.speed, cd: 0, invuln: 0, walk: 0, facing: 0, aim: 0, puff: 0, special: 0, moving: false, flash: 0, isPlayer: true };
  }

  function throwers() { return 1 + G.helpers.length; }

  function loadZone(idx) {
    const def = ZONES[idx];
    const h = def.map.length, w = def.map[0].length;
    Z = {
      idx, def, w, h, pw: w * TILE, ph: h * TILE, grid: [], enemies: [], proj: [], parts: [], texts: [], decals: [], hazards: [], fading: [],
      exits: [], doorOpen: false, field: new Int16Array(w * h), fieldT: 0, fieldTile: -1, banner: 2.6, flyT: 0, cleared: false, bossIntro: false,
    };
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        let ch = def.map[y][x];
        if (ch === 'S') { Z.start = { x: x * TILE + 16, y: y * TILE + 16 }; ch = '.'; }
        else if (ENEMIES[ch]) { Z.enemies.push(makeEnemy(ch, x * TILE + 16, y * TILE + 16)); ch = '.'; }
        else if (ch === 'E') Z.exits.push({ x, y });
        row.push(ch);
      }
      Z.grid.push(row);
    }
    Z.bg = renderStatic(Z);
    G.zone = idx;
    placeTeam();
    computeField();
    if (def.boss) {
      const boss = Z.enemies.find((e) => e.type === 'K');
      if (boss) { boss.aggro = false; Z.boss = boss; }
    }
    resizeZoom();
  }

  function placeTeam() {
    P.x = Z.start.x; P.y = Z.start.y; P.invuln = 1.5; P.cd = 0.3;
    G.helpers.forEach((hp, i) => {
      const a = (i / Math.max(1, G.helpers.length)) * Math.PI * 2;
      hp.x = P.x; hp.y = P.y;
      for (let k = 18; k > 0; k -= 6) { // nudge out of walls
        const nx = P.x + Math.cos(a) * k, ny = P.y + Math.sin(a) * k;
        if (!boxHits(nx, ny, hp.r)) { hp.x = nx; hp.y = ny; break; }
      }
    });
  }

  function makeEnemy(type, x, y) {
    const d = ENEMIES[type];
    return {
      type, def: d, x, y, r: d.r, hp: d.hp, max: d.hp, cd: rand(0.5, 1.5), aggro: false, flash: 0, walk: rand(0, 6), facing: 0,
      swing: 0, swingT: 0, burning: 0, ignite: 0, igniteT: 0, wander: rand(0, 2), wx: 0, wy: 0, strafe: Math.random() < 0.5 ? 1 : -1,
      prop: type === 'f' ? pick(['mop', 'broom']) : null, smack: rand(0, 6), talkT: rand(2, 6), atkN: 0,
    };
  }

  // ---------------------------------------------------------------- tiles / collision
  function tileAt(tx, ty) { if (tx < 0 || ty < 0 || tx >= Z.w || ty >= Z.h) return '#'; return Z.grid[ty][tx]; }
  function solidTile(tx, ty) { const ch = tileAt(tx, ty); if (ch === 'E') return !Z.doorOpen; return SOLID.indexOf(ch) >= 0; }
  function solidAt(x, y) { return solidTile(Math.floor(x / TILE), Math.floor(y / TILE)); }
  function boxHits(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE), y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidTile(tx, ty)) return true;
    return false;
  }
  function moveEnt(e, dx, dy) {
    if (dx) {
      if (!boxHits(e.x + dx, e.y, e.r)) e.x += dx;
      else if (!dy) { // corner assist: slide toward the middle of the row
        const cy = Math.floor(e.y / TILE) * TILE + 16, n = clamp(cy - e.y, -Math.abs(dx), Math.abs(dx));
        if (n && !boxHits(e.x, e.y + n, e.r)) e.y += n;
      }
    }
    if (dy) {
      if (!boxHits(e.x, e.y + dy, e.r)) e.y += dy;
      else if (!dx) {
        const cx = Math.floor(e.x / TILE) * TILE + 16, n = clamp(cx - e.x, -Math.abs(dy), Math.abs(dy));
        if (n && !boxHits(e.x + n, e.y, e.r)) e.x += n;
      }
    }
  }
  function los(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 10);
    for (let i = 1; i < n; i++) { const t = i / n; if (solidAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false; }
    return true;
  }
  // Breadth-first distance map from the player: everyone uses it to walk the mazes.
  function computeField() {
    const f = Z.field; f.fill(32767);
    const sx = Math.floor(P.x / TILE), sy = Math.floor(P.y / TILE);
    Z.fieldTile = sy * Z.w + sx;
    const q = [sx, sy]; f[sy * Z.w + sx] = 0;
    for (let qi = 0; qi < q.length; qi += 2) {
      const x = q[qi], y = q[qi + 1], d = f[y * Z.w + x] + 1;
      if (x > 0 && !solidTile(x - 1, y) && f[y * Z.w + x - 1] > d) { f[y * Z.w + x - 1] = d; q.push(x - 1, y); }
      if (x < Z.w - 1 && !solidTile(x + 1, y) && f[y * Z.w + x + 1] > d) { f[y * Z.w + x + 1] = d; q.push(x + 1, y); }
      if (y > 0 && !solidTile(x, y - 1) && f[(y - 1) * Z.w + x] > d) { f[(y - 1) * Z.w + x] = d; q.push(x, y - 1); }
      if (y < Z.h - 1 && !solidTile(x, y + 1) && f[(y + 1) * Z.w + x] > d) { f[(y + 1) * Z.w + x] = d; q.push(x, y + 1); }
    }
  }
  function fieldAt(x, y) { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE); if (tx < 0 || ty < 0 || tx >= Z.w || ty >= Z.h) return 32767; return Z.field[ty * Z.w + tx]; }
  function stepToward(e) { // next tile centre on the way to the player
    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    let best = fieldAt(e.x, e.y), bx = null, by = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= Z.w || ny >= Z.h || solidTile(nx, ny)) continue;
      if (dx && dy && (solidTile(tx + dx, ty) || solidTile(tx, ty + dy))) continue;
      const v = Z.field[ny * Z.w + nx];
      if (v < best) { best = v; bx = nx; by = ny; }
    }
    if (bx === null) return null;
    return { x: bx * TILE + 16, y: by * TILE + 16 };
  }
  function slowAt(x, y) { return tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) === '~' ? 0.5 : 1; }

  // ---------------------------------------------------------------- spawning helpers
  function proj(owner, x, y, ang, kind, spd, dmg, extra) {
    const p = Object.assign({ owner, x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, kind, dmg, life: 1.5, rot: rand(0, 6), spin: rand(8, 14) * (Math.random() < 0.5 ? -1 : 1), r: 5 }, extra || {});
    Z.proj.push(p);
    return p;
  }
  function part(x, y, o) { if (Z.parts.length > 700) return; Z.parts.push(Object.assign({ x, y, vx: 0, vy: 0, life: 0.6, max: 0.6, size: 3, color: '#fff', type: 'dot', g: 0 }, o)); }
  function fire(x, y, n, spread) {
    for (let i = 0; i < n; i++) part(x + rand(-spread, spread), y + rand(-spread, spread), { vx: rand(-20, 20), vy: rand(-90, -30), life: rand(0.3, 0.7), max: 0.7, size: rand(3, 7), color: pick(['#ff9f1a', '#ffd32a', '#ff3f34', '#ffc048']), type: 'fire' });
  }
  function smoke(x, y, n) { for (let i = 0; i < n; i++) part(x, y, { vx: rand(-15, 15), vy: rand(-40, -15), life: rand(0.6, 1.2), max: 1.2, size: rand(3, 6), color: '#bbb', type: 'smoke' }); }
  function burst(x, y, color, n, spd) { for (let i = 0; i < n; i++) { const a = rand(0, 7); const s = rand(30, spd || 140); part(x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.5), max: 0.5, size: rand(2, 4), color, g: 200 }); } }
  function text(x, y, t, o) { Z.texts.push(Object.assign({ x, y, t, life: 1, max: 1, color: '#fff', size: 14, vy: -30 }, o)); }
  function say(ent, t, dur) { Z.texts = Z.texts.filter((q) => q.follow !== ent); Z.texts.push({ follow: ent, t, life: dur || 2, max: dur || 2, bubble: true, size: 12, color: '#111', vy: 0, x: 0, y: 0 }); }
  function decal(o) { Z.decals.push(o); if (Z.decals.length > 140) Z.decals.shift(); }

  // ---------------------------------------------------------------- points + helpers
  function addPoints(n, x, y) {
    G.points += n;
    text(x, y - 20, '+' + n, { color: '#ffd32a', size: 13 + Math.min(n, 6) });
    G.prog += n;
    while (G.prog >= 5) {
      G.prog -= 5;
      if (G.helpers.length < MAX_HELPERS) addHelper();
    }
  }
  function addHelper() {
    if (G.helpers.length >= MAX_HELPERS) return;
    let names = HELPER_NAMES.filter((n) => !G.usedNames.includes(n));
    if (!names.length) { G.usedNames = []; names = HELPER_NAMES; }
    const name = pick(names); G.usedNames.push(name);
    const h = { name, x: P.x, y: P.y, r: 10, hp: 3, max: 3, cd: 0.6, walk: 0, facing: 0, flash: 0, shirt: pick(SHIRTS), hat: pick([null, 'cap', 'beanie', 'cowboy']), slot: Math.random() * 6.28 };
    G.helpers.push(h);
    Sfx.helper();
    text(P.x, P.y - 40, name.toUpperCase() + ' JOINED THE CREW!', { color: '#7bed9f', size: 14, life: 1.6, max: 1.6 });
    say(h, pick(['I got your back!', 'Gimme a banana.', 'Let\'s get outta here.', 'Finally!', 'I\'m in.']), 1.6);
  }

  // ---------------------------------------------------------------- damage
  function hurtEnemy(e, dmg, src, opt) {
    if (e.burning > 0 || e.dead) return;
    if (e.type === 'K' && e.shield) {
      if (!opt || !opt.dot) { Sfx.deny(); text(e.x, e.y - 50, 'DENIED', { color: '#ff6b6b', size: 16 }); burst(e.x, e.y, '#74b9ff', 6); }
      return;
    }
    e.hp -= dmg; e.flash = 0.12; e.aggro = true;
    if (!opt || !opt.dot) { G.hits++; addPoints(1, e.x, e.y); Sfx.hit(); }
    if (src && e.type !== 'K') { const a = Math.atan2(e.y - src.y, e.x - src.x); moveEnt(e, Math.cos(a) * 6, Math.sin(a) * 6); }
    if (e.hp <= 0) killEnemy(e);
  }
  function killEnemy(e) {
    e.burning = e.type === 'K' ? 3.2 : 1.7;
    e.bvx = rand(-1, 1); e.bvy = rand(-1, 1);
    G.kills++;
    addPoints(e.def.pts, e.x, e.y - 14);
    Sfx.scream();
    say(e, pick(BURN_LINES), e.burning);
    if (e.type === 'K') {
      Sfx.boss(); shake = 18;
      Z.enemies.forEach((o) => { if (o !== e && !o.burning) { o.hp = 0; o.burning = 1.7; o.bvx = rand(-1, 1); o.bvy = rand(-1, 1); say(o, pick(BURN_LINES), 1.7); } });
    }
  }
  function hurtPlayer(dmg, from) {
    if (P.invuln > 0 || state !== 'play') return;
    P.hp -= dmg; P.invuln = 0.9; P.flash = 0.2; shake = Math.max(shake, 7);
    Sfx.hurt();
    if (from) { const a = Math.atan2(P.y - from.y, P.x - from.x); moveEnt(P, Math.cos(a) * 8, Math.sin(a) * 8); }
    if (P.hp <= 0) loseLife('You got taken out.');
  }
  function hurtHelper(h, dmg) {
    if (h.invuln > 0) return;
    h.hp -= dmg; h.flash = 0.15; h.invuln = 0.6;
    if (h.hp <= 0) {
      G.helpers = G.helpers.filter((q) => q !== h);
      Z.fading.push({ ent: h, t: 1.4 });
      text(h.x, h.y - 30, h.name.toUpperCase() + ' GOT TRESPASSED!', { color: '#ff7675', size: 13, life: 1.6, max: 1.6 });
      Sfx.lose();
    }
  }
  function loseLife(why) {
    G.lives--;
    Sfx.lose(); shake = 12;
    if (G.lives <= 0) { gameOver(why); return; }
    P.hp = P.maxHp; Z.proj = Z.proj.filter((p) => p.owner === 'p'); Z.hazards = [];
    placeTeam(); P.invuln = 2.2;
    text(P.x, P.y - 40, 'LIFE LOST — ' + G.lives + ' LEFT', { color: '#ff7675', size: 16, life: 2, max: 2 });
  }

  // ---------------------------------------------------------------- input
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, active: false };
  const sticks = { move: null, aim: null };
  let wantSpecial = false;

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (state === 'play') {
      if (e.code === 'Space') { wantSpecial = true; e.preventDefault(); }
      if (/^Digit[1-4]$/.test(e.code)) setWeapon(+e.code.slice(5) - 1);
      if (e.code === 'KeyQ') setWeapon(G.weapon - 1);
      if (e.code === 'KeyE') setWeapon(G.weapon + 1);
      if (e.code === 'Escape' || e.code === 'KeyP') setState('pause');
    } else if (state === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) setState('play');
    if (e.code === 'KeyM') toggleMute();
    if (DEBUG && state === 'play') {
      if (e.code === 'KeyN') nextZone();
      if (e.code === 'KeyH') addHelper();
      if (e.code === 'KeyK') Z.enemies.forEach((q) => { if (!q.burning) { q.hp = 0; killEnemy(q); } });
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
  canvas.addEventListener('mousedown', (e) => { Sfx.init(); mouse.x = e.clientX; mouse.y = e.clientY; if (e.button === 0) mouse.down = true; if (e.button === 2) wantSpecial = true; mouse.active = true; });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { if (state === 'play') setWeapon(G.weapon + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    Sfx.init(); e.preventDefault();
    const s = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    if (e.clientX < W / 2) { if (!sticks.move) sticks.move = s; } else if (!sticks.aim) sticks.aim = s;
  }, { passive: false });
  canvas.addEventListener('pointermove', (e) => {
    for (const k of ['move', 'aim']) { const s = sticks[k]; if (s && s.id === e.pointerId) { s.x = e.clientX; s.y = e.clientY; } }
  });
  const endPtr = (e) => { for (const k of ['move', 'aim']) if (sticks[k] && sticks[k].id === e.pointerId) sticks[k] = null; };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  function stickVec(s, max) {
    if (!s) return null;
    let dx = s.x - s.ox, dy = s.y - s.oy; const d = Math.hypot(dx, dy);
    if (d > max) { s.ox = s.x - dx / d * max; s.oy = s.y - dy / d * max; dx = s.x - s.ox; dy = s.y - s.oy; }
    return { x: dx / max, y: dy / max, m: Math.min(1, d / max) };
  }

  function setWeapon(i) {
    const n = G.def.weapons.length; if (n < 2) return;
    G.weapon = ((i % n) + n) % n;
    updateTouchUI();
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    G.time += dt;
    if (Z.banner > 0) Z.banner -= dt;
    shake = Math.max(0, shake - dt * 30);
    updatePlayer(dt);
    if (Z.idx === ZONES.length - 1 && !Z.bossIntro && Z.banner < 1.6 && Z.boss) {
      Z.bossIntro = true; Z.boss.aggro = true; Sfx.boss(); say(Z.boss, 'So. You brought ' + (throwers() - 1) + ' friends.', 2.5);
    }
    Z.fieldT -= dt;
    const pt = Math.floor(P.y / TILE) * Z.w + Math.floor(P.x / TILE);
    if (Z.fieldT <= 0 || pt !== Z.fieldTile) { computeField(); Z.fieldT = 0.3; }
    const frozen = Z.banner > 1.4;
    G.helpers.forEach((h) => updateHelper(h, dt));
    if (!frozen) Z.enemies.forEach((e) => updateEnemy(e, dt));
    separate();
    Z.enemies = Z.enemies.filter((e) => !e.dead);
    updateProj(dt);
    updateHazards(dt);
    updateParts(dt);
    Z.fading = Z.fading.filter((f) => (f.t -= dt) > 0);
    // door
    if (!Z.doorOpen && Z.enemies.length === 0) {
      Z.doorOpen = true; Sfx.door(); computeField();
      P.hp = Math.min(P.maxHp, P.hp + 2);
      text(P.x, P.y - 44, Z.def.boss ? 'THE FRONT DOOR IS OPEN!' : 'ZONE CLEAR — DOOR OPEN!', { color: '#7bed9f', size: 18, life: 2.2, max: 2.2 });
    }
    if (Z.doorOpen && tileAt(Math.floor(P.x / TILE), Math.floor(P.y / TILE)) === 'E') nextZone();
    // ambient flies over the filth
    Z.flyT -= dt;
    if (Z.flyT <= 0 && Z.def.key === 'shower') {
      Z.flyT = 0.15;
      const tx = (Math.random() * Z.w) | 0, ty = (Math.random() * Z.h) | 0;
      if (Z.grid[ty][tx] === '~' || Z.grid[ty][tx] === 'o') part(tx * TILE + 16, ty * TILE + 16, { vx: rand(-40, 40), vy: rand(-40, 40), life: 1.5, max: 1.5, size: 1.6, color: '#111', type: 'fly' });
    }
  }

  function nextZone() {
    if (Z.idx >= ZONES.length - 1) { victory(); return; }
    const next = Z.idx + 1;
    if (ZONES[next].boss && throwers() < NEEDED_FOR_BOSS) { kickBack(); return; }
    loadZone(next);
  }

  function updatePlayer(dt) {
    P.invuln -= dt; P.flash -= dt; P.special -= dt; P.cd -= dt;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my -= 1;
    if (keys.KeyS || keys.ArrowDown) my += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    const mv = stickVec(sticks.move, 55);
    if (mv && mv.m > 0.15) { mx = mv.x; my = mv.y; }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const sp = P.speed * slowAt(P.x, P.y);
    P.moving = ml > 0.1;
    if (P.moving) { moveEnt(P, mx * sp * dt, my * sp * dt); P.walk += dt * 12 * Math.min(1, ml); }
    // aim + fire
    let firing = false;
    const av = stickVec(sticks.aim, 55);
    if (av && av.m > 0.25) { P.aim = Math.atan2(av.y, av.x); firing = true; }
    else if (mouse.active && !isTouchActive()) {
      const w = screenToWorld(mouse.x, mouse.y);
      P.aim = Math.atan2(w.y - (P.y - 6), w.x - P.x);
      firing = mouse.down;
    } else if (P.moving) P.aim = Math.atan2(my, mx);
    if (keys.KeyJ || keys.KeyF) firing = true;
    P.facing = P.aim;
    const wkey = G.def.weapons[G.weapon];
    if (P.puff > 0) { P.puff -= dt; if (P.puff <= 0) { throwWeapon('cig'); } }
    else if (firing && P.cd <= 0) {
      if (wkey === 'cig') { P.puff = 0.22; Sfx.puff(); smoke(P.x + 3, P.y - 18, 3); }
      else throwWeapon(wkey);
    }
    if (wantSpecial) { wantSpecial = false; if (G.def.special && P.special <= 0) fart(); }
  }
  function isTouchActive() { return !!(sticks.move || sticks.aim); }

  function throwWeapon(w) {
    const hx = P.x + Math.cos(P.aim) * 8, hy = P.y - 6 + Math.sin(P.aim) * 8;
    P.cd = WEAPONS[w].cd * G.def.rate;
    Sfx.throw();
    if (w === 'banana') proj('p', hx, hy, P.aim, 'banana', 430, 1, { r: 6 });
    else if (w === 'bunch') [-0.22, 0, 0.22].forEach((o) => proj('p', hx, hy, P.aim + o, 'banana', 410, 1, { r: 6 }));
    else if (w === 'egg') proj('p', hx, hy, P.aim + rand(-0.06, 0.06), 'egg', 540, 1, { r: 5 });
    else if (w === 'bottle') proj('p', hx, hy, P.aim, 'bottle', 360, 2, { r: 6, life: 0.9, spin: 12 });
    else if (w === 'cig') { proj('p', hx, hy, P.aim, 'cig', 420, 1, { r: 5, ignite: true, spin: 18 }); }
  }

  function fart() {
    P.special = 3.2;
    const dir = P.aim + Math.PI;
    Sfx.fart(); shake = 10;
    text(P.x, P.y - 40, pick(['PFFFRRRRT!', 'BRRAAAAAP!', 'FWOOOOSH!']), { color: '#ffa502', size: 20, life: 1.2, max: 1.2 });
    for (let i = 0; i < 70; i++) {
      const a = dir + rand(-0.6, 0.6), s = rand(120, 330);
      part(P.x - Math.cos(P.aim) * 8, P.y + 2 - Math.sin(P.aim) * 8, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.6), max: 0.6, size: rand(4, 9), color: pick(['#ff9f1a', '#ffd32a', '#ff3f34', '#ffc048', '#7bed9f']), type: 'fire' });
    }
    Z.enemies.forEach((e) => {
      if (e.burning) return;
      const d = dst(P, e);
      if (d < 175 + e.r && Math.abs(angDiff(angTo(P, e), dir)) < 0.7 + (e.r > 20 ? 0.3 : 0)) {
        hurtEnemy(e, 4, P); if (!e.burning && !e.shield) { e.ignite = 1.6; }
      }
    });
    Z.proj.forEach((p) => { if (p.owner === 'e' && dst(p, P) < 175 && Math.abs(angDiff(angTo(P, p), dir)) < 0.8) p.dead = true; });
  }

  function updateHelper(h, dt) {
    h.cd -= dt; h.flash -= dt; h.invuln = (h.invuln || 0) - dt;
    // pick a target
    let tgt = null, best = 340;
    Z.enemies.forEach((e) => { if (e.burning) return; const d = dst(h, e); if (d < best && los(h.x, h.y - 6, e.x, e.y)) { best = d; tgt = e; } });
    if (tgt && h.cd <= 0) {
      const a = angTo({ x: h.x, y: h.y - 6 }, tgt) + rand(-0.08, 0.08);
      proj('p', h.x, h.y - 6, a, 'banana', 400, 1, { r: 6 });
      h.cd = rand(0.7, 1.05); h.facing = a;
    }
    // follow
    const i = G.helpers.indexOf(h);
    const sa = (i / Math.max(1, G.helpers.length)) * Math.PI * 2 + G.time * 0.3;
    const goal = { x: P.x + Math.cos(sa) * 38, y: P.y + Math.sin(sa) * 30 };
    const dP = dst(h, P);
    let tx = goal.x, ty = goal.y;
    if (dP > 110 || !los(h.x, h.y, P.x, P.y)) { const st = stepToward(h); if (st) { tx = st.x; ty = st.y; } else { tx = P.x; ty = P.y; } }
    const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d > 6) {
      const sp = (dP > 160 ? 210 : 150) * slowAt(h.x, h.y) * dt;
      moveEnt(h, dx / d * Math.min(sp, d), dy / d * Math.min(sp, d)); h.walk += dt * 12;
      if (!tgt) h.facing = Math.atan2(dy, dx);
    }
    if (dP > 600) { h.x = P.x; h.y = P.y; } // stuck: catch up
  }

  function chooseTarget(e) {
    let tgt = P, best = dst(e, P);
    let pLos = los(e.x, e.y, P.x, P.y);
    if (!pLos) best = 1e9;
    G.helpers.forEach((h) => { const d = dst(e, h); if (d < best && los(e.x, e.y, h.x, h.y)) { best = d; tgt = h; } });
    return { t: tgt, d: dst(e, tgt), los: tgt === P ? pLos : true };
  }

  function updateEnemy(e, dt) {
    e.flash -= dt;
    if (e.burning > 0) {
      e.burning -= dt;
      if (Math.random() < dt * 3) { e.bvx = rand(-1, 1); e.bvy = rand(-1, 1); }
      const sp = e.type === 'K' ? 30 : 120;
      moveEnt(e, e.bvx * sp * dt, e.bvy * sp * dt); e.walk += dt * 25;
      fire(e.x, e.y - 6, e.type === 'K' ? 4 : 2, e.r * 0.7);
      if (Math.random() < dt * 6) smoke(e.x, e.y - 24, 1);
      if (e.burning <= 0) {
        e.dead = true;
        decal({ type: 'ash', x: e.x, y: e.y + 8, r: e.r, seed: Math.random() });
        smoke(e.x, e.y, 8);
      }
      return;
    }
    if (e.ignite > 0) {
      e.ignite -= dt; e.igniteT -= dt;
      fire(e.x, e.y - 8, 1, 6);
      if (e.igniteT <= 0) { e.igniteT = 0.4; hurtEnemy(e, 1, null, { dot: true }); if (e.burning) return; }
    }
    if (e.type === 'K') { updateBoss(e, dt); return; }
    e.cd -= dt; e.smack += dt * 8; e.talkT -= dt;
    const T = chooseTarget(e);
    const tgt = T.t, d = T.d;
    const fd = fieldAt(e.x, e.y);
    if (!e.aggro && (fd <= 12 || (T.los && d < 360))) { e.aggro = true; if (Math.random() < 0.6) say(e, pick(e.def.lines), 1.6); }
    if (!e.aggro) {
      e.wander -= dt;
      if (e.wander <= 0) { e.wander = rand(1, 2.5); const a = rand(0, 6.28); e.wx = Math.cos(a) * 25; e.wy = Math.sin(a) * 25; if (Math.random() < 0.4) { e.wx = 0; e.wy = 0; } }
      if (e.wx || e.wy) { moveEnt(e, e.wx * dt, e.wy * dt); e.walk += dt * 6; e.facing = Math.atan2(e.wy, e.wx); }
      return;
    }
    if (e.talkT <= 0) { e.talkT = rand(5, 10); if (Math.random() < 0.5) say(e, pick(e.def.lines), 1.6); }
    const def = e.def;
    let goal = null, speed = def.speed * slowAt(e.x, e.y);
    const melee = def.attack === 'melee' || def.attack === 'ruler';
    const aim = angTo(e, tgt);
    if (melee) {
      if (e.swing > 0) {
        e.swing -= dt; speed *= 0.2;
        if (e.swing <= 0) {
          Sfx.swing();
          const reach = def.range + 14;
          if (dst(e, P) < reach) hurtPlayer(1, e);
          G.helpers.forEach((h) => { if (dst(e, h) < reach) hurtHelper(h, 1); });
          burst(e.x + Math.cos(e.swingAng) * 22, e.y + Math.sin(e.swingAng) * 22, def.attack === 'ruler' ? '#f1c40f' : '#74b9ff', 6, 80);
        }
      } else if (T.los && d < def.range + tgt.r && e.cd <= 0) {
        e.swing = 0.32; e.swingAng = aim; e.cd = def.cd;
        if (def.attack === 'ruler') say(e, '*WHACK*', 0.6);
      } else if (T.los && d > def.range * 0.6) goal = tgt;
    } else {
      if (T.los && d < def.range) {
        if (d < def.range * 0.35) goal = { x: e.x - Math.cos(aim) * 40, y: e.y - Math.sin(aim) * 40 };
        else { const s = aim + Math.PI / 2 * e.strafe; moveEnt(e, Math.cos(s) * speed * 0.35 * dt, Math.sin(s) * speed * 0.35 * dt); if (Math.random() < dt * 0.6) e.strafe *= -1; e.walk += dt * 4; }
        if (e.cd <= 0) { enemyAttack(e, tgt, aim); e.cd = def.cd * rand(0.8, 1.25); }
      } else if (T.los) goal = tgt;
    }
    if (!goal && !T.los) goal = stepToward(e) || P;
    if (goal && !(melee && e.swing > 0)) {
      const dx = goal.x - e.x, dy = goal.y - e.y, gd = Math.hypot(dx, dy);
      if (gd > 2) { const s = Math.min(gd, speed * dt); moveEnt(e, dx / gd * s, dy / gd * s); e.walk += dt * 10; }
    }
    e.facing = aim;
  }

  function enemyAttack(e, tgt, aim) {
    const hx = e.x + Math.cos(aim) * 10, hy = e.y - 8;
    const lead = aim + rand(-0.07, 0.07);
    switch (e.def.attack) {
      case 'wrench': proj('e', hx, hy, lead, 'wrench', 255, 1, { r: 7, life: 1.8, spin: 14 }); break;
      case 'notebook': proj('e', hx, hy, lead, 'notebook', 245, 1, { r: 7, life: 1.8, spin: 9 }); break;
      case 'beebee':
        e.point = 0.4;
        [-0.2, 0, 0.2].forEach((o) => {
          const hot = Math.random() < 0.35;
          proj('e', hx, hy, aim + o + rand(-0.04, 0.04), hot ? 'firebb' : 'bb', hot ? 230 : 300, 1, { r: hot ? 5 : 3.5, life: 1.4, spin: 0 });
        });
        break;
      case 'office':
        e.atkN++;
        if (e.atkN % 2) proj('e', hx, hy, lead, 'stapler', 230, 1, { r: 7, life: 1.9, spin: 10 });
        else [-0.1, 0.1].forEach((o) => proj('e', hx, hy, aim + o, 'pen', 380, 1, { r: 4, life: 1.2, spin: 0 }));
        break;
    }
  }

  function updateBoss(e, dt) {
    e.shield = throwers() < NEEDED_FOR_BOSS;
    e.walk += dt * 5; e.talkT -= dt;
    if (!e.aggro) return;
    const d = dst(e, P), aim = angTo(e, P), seen = los(e.x, e.y, P.x, P.y);
    let goal = null;
    if (!seen || d > 230) goal = seen ? P : stepToward(e) || P;
    else if (d < 120) goal = { x: e.x - Math.cos(aim) * 40, y: e.y - Math.sin(aim) * 40 };
    if (goal) { const dx = goal.x - e.x, dy = goal.y - e.y, gd = Math.hypot(dx, dy); if (gd > 2) moveEnt(e, dx / gd * e.def.speed * dt, dy / gd * e.def.speed * dt); }
    else moveEnt(e, Math.cos(G.time) * 20 * dt, 0);
    e.facing = aim;
    e.cd -= dt;
    if (e.talkT <= 0) { e.talkT = rand(4, 7); say(e, e.shield ? 'You need FIVE people to touch me.' : pick(e.def.lines), 2.2); }
    if (e.cd > 0) return;
    const hpf = e.hp / e.max;
    e.cd = hpf < 0.5 ? 1.15 : 1.6;
    const hx = e.x, hy = e.y - 20;
    const pat = pick(['barrage', 'aimed', 'fire', 'summon', 'aimed', 'notebooks']);
    if (pat === 'barrage') { const n = hpf < 0.5 ? 18 : 12; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + G.time; proj('e', hx, hy, a, i % 2 ? 'pen' : 'stapler', i % 2 ? 300 : 210, 1, { r: i % 2 ? 4 : 7, life: 2.2 }); } }
    else if (pat === 'aimed') { for (let i = -2; i <= 2; i++) proj('e', hx, hy, aim + i * 0.12, 'pen', 360, 1, { r: 4, life: 1.6, spin: 0 }); }
    else if (pat === 'notebooks') { for (let i = -1; i <= 1; i++) proj('e', hx, hy, aim + i * 0.25, 'notebook', 260, 1, { r: 7, life: 2 }); }
    else if (pat === 'fire') { e.point = 0.5; for (let i = -3; i <= 3; i++) proj('e', hx, hy, aim + i * 0.15, 'firebb', 240, 1, { r: 5, life: 1.6, spin: 0 }); }
    else if (pat === 'summon') {
      const minions = Z.enemies.filter((q) => q.type !== 'K' && !q.burning).length;
      if (minions < 4) {
        say(e, pick(['STAFF! Assist!', 'Somebody get this person!', 'Facilities, please!']), 1.5);
        for (let i = 0; i < 2; i++) {
          const a = rand(0, 6.28), x = e.x + Math.cos(a) * 50, y = e.y + Math.sin(a) * 50;
          if (!boxHits(x, y, 11)) { const m = makeEnemy(pick(['f', 'f', 'c', 'm']), x, y); m.aggro = true; Z.enemies.push(m); smoke(x, y, 6); }
        }
      } else proj('e', hx, hy, aim, 'stapler', 240, 1, { r: 7, life: 2 });
    }
  }

  function separate() {
    const all = Z.enemies.concat(G.helpers);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r - 4;
      if (d > 0 && d < m) {
        const push = (m - d) / 2, nx = dx / d * push, ny = dy / d * push;
        if (a.type !== 'K') moveEnt(a, -nx, -ny);
        if (b.type !== 'K') moveEnt(b, nx, ny);
      }
    }
  }

  function updateProj(dt) {
    for (const p of Z.proj) {
      p.life -= dt; p.rot += p.spin * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'firebb') { if (Math.random() < 0.6) fire(p.x, p.y, 1, 2); }
      if (p.kind === 'cig' && Math.random() < 0.5) smoke(p.x, p.y, 1);
      if (solidAt(p.x, p.y)) { projEnd(p, true); continue; }
      if (p.life <= 0) { projEnd(p, false); continue; }
      if (p.owner === 'p') {
        for (const e of Z.enemies) {
          if (e.burning) continue;
          const hr = e.r + p.r + (e.type === 'K' ? 6 : 2);
          if (Math.abs(e.x - p.x) < hr && Math.abs(e.y - 6 - p.y) < hr + 6 && Math.hypot(e.x - p.x, e.y - 6 - p.y) < hr + 4) {
            hurtEnemy(e, p.dmg, p);
            if (p.ignite && !e.burning && !e.shield) { e.ignite = 1.5; e.igniteT = 0.3; }
            projEnd(p, false, e);
            break;
          }
        }
      } else {
        if (Math.hypot(P.x - p.x, P.y - 6 - p.y) < P.r + p.r + 2) { hurtPlayer(p.dmg, p); projEnd(p, false); continue; }
        for (const h of G.helpers) if (Math.hypot(h.x - p.x, h.y - 6 - p.y) < h.r + p.r) { hurtHelper(h, p.dmg); projEnd(p, false); break; }
      }
    }
    Z.proj = Z.proj.filter((p) => !p.dead);
  }
  function projEnd(p, wall, hitEnt) {
    if (p.dead) return; p.dead = true;
    const bx = p.x - p.vx * 0.016, by = p.y - p.vy * 0.016;
    switch (p.kind) {
      case 'banana': decal({ type: 'peel', x: bx, y: by + 6, rot: rand(0, 6) }); burst(bx, by, '#ffe066', 4, 80); break;
      case 'egg': decal({ type: 'egg', x: bx, y: by + 6, rot: rand(0, 6) }); Sfx.splat(); burst(bx, by, '#fff3bf', 6, 90); break;
      case 'bottle':
        Sfx.shatter(); burst(bx, by, '#c58b3a', 10, 160); burst(bx, by, '#fffbe6', 6, 120);
        decal({ type: 'glass', x: bx, y: by + 6, rot: rand(0, 6) });
        Z.enemies.forEach((e) => { if (e !== hitEnt && !e.burning && Math.hypot(e.x - bx, e.y - by) < 52 + e.r) hurtEnemy(e, 1, { x: bx, y: by }); });
        break;
      case 'cig': fire(bx, by, 6, 4); break;
      case 'firebb': Z.hazards.push({ x: bx, y: by + 4, r: 13, life: 2.2, max: 2.2 }); fire(bx, by, 6, 6); break;
      default: burst(bx, by, wall ? '#ddd' : '#fff', 4, 70);
    }
  }
  function updateHazards(dt) {
    Z.hazards = Z.hazards.filter((h) => (h.life -= dt) > 0);
    for (const h of Z.hazards) {
      if (Math.random() < dt * 8) fire(h.x, h.y, 1, h.r * 0.6);
      if (Math.hypot(P.x - h.x, P.y - h.y) < h.r + P.r - 2) hurtPlayer(1, h);
    }
  }
  function updateParts(dt) {
    for (const q of Z.parts) {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt;
      if (q.type === 'fire') { q.vx *= 0.95; q.vy *= 0.97; }
      if (q.type === 'fly') { q.vx += rand(-300, 300) * dt; q.vy += rand(-300, 300) * dt; q.vx = clamp(q.vx, -60, 60); q.vy = clamp(q.vy, -60, 60); }
    }
    Z.parts = Z.parts.filter((q) => q.life > 0);
    for (const t of Z.texts) { t.life -= dt; if (!t.follow) t.y += t.vy * dt; }
    Z.texts = Z.texts.filter((t) => t.life > 0);
  }

  // ---------------------------------------------------------------- static zone art
  function renderStatic(z) {
    const c = document.createElement('canvas');
    c.width = z.pw; c.height = z.ph;
    const g = c.getContext('2d');
    const k = z.def.key;
    for (let y = 0; y < z.h; y++) for (let x = 0; x < z.w; x++) drawFloor(g, k, x, y);
    // floor sign
    g.save(); g.globalAlpha = 0.13; g.fillStyle = '#000'; g.font = 'bold 64px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(z.def.name, z.pw / 2, z.ph / 2); g.restore();
    for (let y = 0; y < z.h; y++) for (let x = 0; x < z.w; x++) {
      const ch = z.grid[y][x];
      if (ch === '~') drawFilth(g, x, y);
      else if (SOLID.indexOf(ch) >= 0) drawSolid(g, k, ch, x, y, z);
    }
    return c;
  }
  function drawFloor(g, k, x, y) {
    const px = x * TILE, py = y * TILE, r = hash(x, y, 1);
    switch (k) {
      case 'camp':
        g.fillStyle = r < 0.5 ? '#6f6b63' : '#726e66'; g.fillRect(px, py, TILE, TILE);
        g.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 5; i++) g.fillRect(px + hash(x, y, i + 3) * 30, py + hash(x, y, i + 9) * 30, 2, 2);
        if (hash(x, y, 77) < 0.04) { g.fillStyle = 'rgba(30,20,10,0.25)'; g.beginPath(); g.ellipse(px + 16, py + 16, 12, 7, r * 3, 0, 7); g.fill(); }
        break;
      case 'shower':
        g.fillStyle = '#d6d5c9'; g.fillRect(px, py, TILE, TILE);
        g.strokeStyle = '#a9a795'; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, 15, 15); g.strokeRect(px + 16.5, py + 0.5, 15, 15); g.strokeRect(px + 0.5, py + 16.5, 15, 15); g.strokeRect(px + 16.5, py + 16.5, 15, 15);
        if (r < 0.45) { g.fillStyle = `rgba(${90 + r * 60 | 0},70,30,${0.15 + r * 0.4})`; g.beginPath(); g.ellipse(px + hash(x, y, 2) * 32, py + hash(x, y, 3) * 32, 4 + r * 14, 3 + r * 9, r * 6, 0, 7); g.fill(); }
        if (hash(x, y, 5) < 0.2) { g.fillStyle = 'rgba(60,110,40,0.35)'; for (let i = 0; i < 6; i++) g.fillRect(px + hash(x, y, i + 20) * 30, py + hash(x, y, i + 40) * 30, 2, 2); }
        break;
      case 'laundry':
        g.fillStyle = (x + y) % 2 ? '#cfc4a8' : '#bcb092'; g.fillRect(px, py, TILE, TILE);
        if (r < 0.15) { g.fillStyle = 'rgba(220,220,230,0.7)'; g.beginPath(); g.arc(px + 10 + r * 60, py + 20, 3, 0, 7); g.fill(); }
        break;
      case 'sprung':
        g.fillStyle = r < 0.5 ? '#a4a39b' : '#a9a8a0'; g.fillRect(px, py, TILE, TILE);
        if (r < 0.08) { g.strokeStyle = 'rgba(60,60,60,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + 4, py + 6); g.lineTo(px + 14, py + 15); g.lineTo(px + 12, py + 26); g.stroke(); }
        if (hash(x, y, 9) < 0.05) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(px + 8, py + 10, 7, 5); } // trash
        break;
      case 'cafe':
        g.fillStyle = (x + y) % 2 ? '#ebe4d4' : '#b04a3a'; g.fillRect(px, py, TILE, TILE);
        if (r < 0.07) { g.fillStyle = 'rgba(140,100,30,0.45)'; g.beginPath(); g.ellipse(px + 16, py + 16, 9, 6, r * 9, 0, 7); g.fill(); }
        break;
      case 'admin':
        g.fillStyle = '#56606b'; g.fillRect(px, py, TILE, TILE);
        g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 8; i++) g.fillRect(px + hash(x, y, i) * 31, py + hash(x, y, i + 50) * 31, 1, 1);
        if (r < 0.05) { g.strokeStyle = 'rgba(80,50,20,0.5)'; g.lineWidth = 2; g.beginPath(); g.arc(px + 16, py + 16, 6, 0, 7); g.stroke(); } // coffee ring
        break;
      default: // lobby
        g.fillStyle = (x + y) % 2 ? '#d8d1c1' : '#cfc7b6'; g.fillRect(px, py, TILE, TILE);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(px + 2, py + 2, 10, 2);
    }
  }
  function drawFilth(g, x, y) {
    const px = x * TILE, py = y * TILE, r = hash(x, y, 4);
    g.fillStyle = 'rgba(92,74,30,0.85)'; g.beginPath(); g.ellipse(px + 16, py + 16, 17, 14, r * 3, 0, 7); g.fill();
    g.fillStyle = 'rgba(110,130,40,0.6)'; g.beginPath(); g.ellipse(px + 12 + r * 6, py + 14, 8, 5, r * 5, 0, 7); g.fill();
    g.fillStyle = 'rgba(40,30,10,0.6)'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(px + 6 + hash(x, y, i) * 20, py + 6 + hash(x, y, i + 7) * 20, 1.5 + hash(x, y, i + 2) * 2, 0, 7); g.fill(); }
  }
  function drawSolid(g, k, ch, x, y, z) {
    const px = x * TILE, py = y * TILE, r = hash(x, y, 2);
    const same = (dx, dy) => { const c2 = (z.grid[y + dy] || [])[x + dx]; return c2 === ch; };
    switch (ch) {
      case '#': {
        const col = { shower: '#4e7d77', laundry: '#a8976f', sprung: '#eeeee6', cafe: '#e0d4b4', admin: '#c2b49a', lobby: '#5d6d7e' }[k] || '#555';
        g.fillStyle = col; g.fillRect(px, py, TILE, TILE);
        g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(px, py, TILE, 4);
        g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(px, py + TILE - 4, TILE, 4);
        if (k === 'sprung') { g.fillStyle = '#c8c8be'; g.fillRect(px + 14, py, 4, TILE); } // tent ribs
        if (k === 'shower') { g.strokeStyle = 'rgba(0,0,0,0.15)'; g.strokeRect(px + 0.5, py + 0.5, 15, 15); g.strokeRect(px + 16.5, py + 16.5, 15, 15); }
        if (k === 'lobby') { g.fillStyle = 'rgba(160,210,255,0.25)'; g.fillRect(px + 3, py + 6, TILE - 6, 10); }
        break;
      }
      case 'x':
        g.save(); g.beginPath(); g.rect(px, py, TILE, TILE); g.clip();
        g.fillStyle = 'rgba(30,30,30,0.25)'; g.fillRect(px, py, TILE, TILE);
        g.strokeStyle = 'rgba(200,205,210,0.7)'; g.lineWidth = 1;
        for (let i = -32; i < 32; i += 8) { g.beginPath(); g.moveTo(px + i, py); g.lineTo(px + i + 32, py + 32); g.stroke(); g.beginPath(); g.moveTo(px + i + 32, py); g.lineTo(px + i, py + 32); g.stroke(); }
        g.restore();
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py + 28, TILE, 4);
        g.fillStyle = '#8a9096'; g.fillRect(px + 14, py, 4, TILE);
        if (r < 0.15) { g.fillStyle = '#1e3799'; g.fillRect(px + 2, py + 8, 28, 12); } // privacy tarp
        break;
      case 'P': {
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(px + 4, py + 6, TILE - 4, TILE - 4);
        g.fillStyle = '#f2f1ea'; g.fillRect(px + 2, py + 2, TILE - 5, TILE - 5);
        g.fillStyle = '#d9d8cf'; g.fillRect(px + 2, py + TILE - 12, TILE - 5, 9);
        g.strokeStyle = '#9a9a92'; g.lineWidth = 1; g.strokeRect(px + 2.5, py + 2.5, TILE - 6, TILE - 6);
        if (r < 0.5) { g.fillStyle = '#5d6d7e'; g.fillRect(px + 10, py + TILE - 13, 9, 10); }
        g.fillStyle = '#333'; g.font = '8px sans-serif'; g.fillText(String(1 + ((x * 7 + y * 3) % 50)), px + 5, py + 11);
        break;
      }
      case 'B':
        g.fillStyle = '#7f8c8d'; g.fillRect(px + 1, py + 3, TILE - 2, TILE - 6);
        g.fillStyle = ['#34495e', '#2e86de', '#6d4c41', '#7d5fff', '#3c6382'][(r * 5) | 0]; g.fillRect(px + 3, py + 6, TILE - 6, TILE - 12);
        if (!same(-1, 0)) { g.fillStyle = '#f5f6fa'; g.fillRect(px + 4, py + 8, 7, TILE - 16); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px + 1, py + TILE - 4, TILE - 2, 2);
        break;
      case 'C':
        g.fillStyle = '#b08850'; g.fillRect(px, py, TILE, TILE);
        g.strokeStyle = '#7a5a2e'; g.lineWidth = 2; g.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        g.fillStyle = '#5a4020'; g.fillRect(px + TILE - 9, py + 14, 3, 5);
        break;
      case 'W': {
        g.fillStyle = '#f0f0f0'; g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        g.strokeStyle = '#999'; g.lineWidth = 1; g.strokeRect(px + 2.5, py + 2.5, TILE - 5, TILE - 5);
        g.fillStyle = '#2d3436'; g.beginPath(); g.arc(px + 16, py + 17, 9, 0, 7); g.fill();
        g.fillStyle = r < 0.5 ? '#74b9ff' : '#636e72'; g.beginPath(); g.arc(px + 16, py + 17, 6, 0, 7); g.fill();
        if (r > 0.6) { g.fillStyle = '#e17055'; g.fillRect(px + 4, py + 4, 24, 7); g.fillStyle = '#fff'; g.font = 'bold 6px sans-serif'; g.fillText('OUT OF ORDER', px + 5, py + 10); }
        break;
      }
      case 'T':
        if (k === 'laundry') { g.fillStyle = '#8d6e46'; g.fillRect(px, py + 5, TILE, TILE - 10); g.fillStyle = '#fff'; if (r < 0.4) g.fillRect(px + 6, py + 9, 12, 8); }
        else {
          g.fillStyle = '#95a5a6'; g.fillRect(px, py + 4, TILE, TILE - 8);
          g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(px, py + TILE - 6, TILE, 2);
          if (r < 0.6) { g.fillStyle = '#e67e22'; g.fillRect(px + 5, py + 9, 14, 12); g.fillStyle = ['#6d4c41', '#a3cb38', '#ffeaa7'][(r * 5 | 0) % 3]; g.beginPath(); g.arc(px + 12, py + 15, 4, 0, 7); g.fill(); }
        }
        break;
      case 'L':
        g.fillStyle = '#bdc3c7'; g.fillRect(px, py, TILE, TILE);
        g.fillStyle = '#7f8c8d'; g.fillRect(px + 3, py + 6, TILE - 6, 16);
        g.fillStyle = ['#8e6e53', '#d4a017', '#6b8e23', '#a0522d', '#c9b18c'][(r * 5) | 0]; g.fillRect(px + 5, py + 8, TILE - 10, 12);
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(px, py + 24, TILE, 3);
        break;
      case 'D':
        g.fillStyle = '#8b6a43'; g.fillRect(px, py + 2, TILE, TILE - 4);
        if (!same(-1, 0)) { g.fillStyle = '#222'; g.fillRect(px + 6, py + 5, 14, 10); g.fillStyle = '#4aa3df'; g.fillRect(px + 7, py + 6, 12, 8); }
        g.fillStyle = '#fff'; g.fillRect(px + 14 + r * 8, py + 18, 9, 7);
        break;
      case 'F':
        g.fillStyle = '#7f8c8d'; g.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        g.strokeStyle = '#596566'; g.lineWidth = 1; for (let i = 0; i < 3; i++) g.strokeRect(px + 4.5, py + 4.5 + i * 8, TILE - 9, 6);
        break;
      case 'H':
        g.fillStyle = '#bdc8c6'; g.fillRect(px + 2, py, TILE - 4, TILE);
        g.fillStyle = '#e8f0ef'; g.fillRect(px + 6, py + 2, TILE - 12, TILE - 4);
        g.fillStyle = 'rgba(40,90,30,0.5)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(px + 6 + hash(x, y, i) * 20, py + 4 + hash(x, y, i + 9) * 24, 1 + hash(x, y, i + 3) * 2.5, 0, 7); g.fill(); }
        break;
      case 'o':
        g.fillStyle = '#ecf0f1'; g.fillRect(px + 9, py + 2, 14, 8);
        g.beginPath(); g.ellipse(px + 16, py + 19, 8, 10, 0, 0, 7); g.fill();
        g.fillStyle = '#8b7d3a'; g.beginPath(); g.ellipse(px + 16, py + 19, 4, 6, 0, 0, 7); g.fill();
        g.strokeStyle = '#95a5a6'; g.lineWidth = 1; g.beginPath(); g.ellipse(px + 16, py + 19, 8, 10, 0, 0, 7); g.stroke();
        break;
      case 'R':
        g.fillStyle = '#5b3a29'; g.fillRect(px, py + 4, TILE, TILE - 8);
        g.fillStyle = '#8d6346'; g.fillRect(px, py + 4, TILE, 6);
        if (x === 14 || x === 15) { g.fillStyle = '#fff'; g.font = 'bold 7px sans-serif'; g.fillText(x === 14 ? 'TAKE A' : 'NUMBER', px + 2, py + 22); }
        break;
    }
  }

  // ---------------------------------------------------------------- drawing: stick figures
  function stick(x, y, o) {
    const s = o.scale || 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(0, 13, 10, 3.5, 0, 0, 7); ctx.fill();
    const flip = Math.cos(o.facing) < 0 ? -1 : 1;
    const sw = o.moving === false ? 0 : Math.sin(o.walk || 0);
    const line = o.flash > 0 ? '#ff4757' : (o.line || '#111');
    ctx.strokeStyle = line; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // legs
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-3 + sw * 5, 13); ctx.moveTo(0, 2); ctx.lineTo(3 - sw * 5, 13); ctx.stroke();
    // body
    if (o.dress) { ctx.fillStyle = o.shirt; ctx.beginPath(); ctx.moveTo(-3, -9); ctx.lineTo(3, -9); ctx.lineTo(7, 5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else {
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 3); ctx.stroke();
      if (o.shirt) { ctx.fillStyle = o.shirt; ctx.fillRect(-4.5, -9, 9, 10); ctx.strokeRect(-4.5, -9, 9, 10); }
      if (o.vest) { ctx.fillStyle = o.vest; ctx.fillRect(-4.5, -9, 3, 10); ctx.fillRect(1.5, -9, 3, 10); ctx.fillStyle = '#dfe6e9'; ctx.fillRect(-4.5, -5, 9, 1.5); }
    }
    if (o.lanyard) { ctx.strokeStyle = '#0984e3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-2, -9); ctx.lineTo(0, -3); ctx.lineTo(2, -9); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect(-1.5, -3, 3, 4); ctx.strokeStyle = line; ctx.lineWidth = 2.6; }
    if (o.tie) { ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(1.5, -4); ctx.lineTo(0, -1); ctx.lineTo(-1.5, -4); ctx.fill(); }
    if (o.look === 'backpack') { ctx.fillStyle = '#e1b12c'; ctx.fillRect(-flip * 8 - 2.5, -9, 5, 9); }
    // arms
    const aim = o.aimAng !== undefined ? o.aimAng : o.facing;
    const hx = Math.cos(aim) * 9, hy = -6 + Math.sin(aim) * 7;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(hx, hy);
    ctx.moveTo(0, -7); ctx.lineTo(-flip * 6, -1 + sw * 2); ctx.stroke();
    // head
    ctx.fillStyle = o.skin || '#fff'; ctx.beginPath(); ctx.arc(0, -14, 5.2, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = line; ctx.fillRect(flip * 1.5, -15.5, 1.4, 1.4);
    drawHat(o, flip);
    drawProp(o, hx, hy, aim, flip);
    ctx.restore();
  }
  function drawHat(o, flip) {
    switch (o.look) {
      case 'ralph':
        ctx.fillStyle = '#8e2d2d'; ctx.beginPath(); ctx.arc(0, -16, 5.6, Math.PI, 0); ctx.fill(); ctx.fillRect(-5.8, -17, 11.6, 2.5);
        ctx.fillStyle = '#9b9b9b'; ctx.beginPath(); ctx.moveTo(-4, -12.5); ctx.lineTo(4, -12.5); ctx.lineTo(1.5, -8); ctx.lineTo(-1.5, -8); ctx.fill(); // beard
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(flip * 3, -11.5); ctx.lineTo(flip * 8, -12.5); ctx.stroke(); // cigarette
        ctx.fillStyle = '#ff6b00'; ctx.fillRect(flip * 8 - 1, -13.5, 2, 2);
        break;
      case 'headband': ctx.fillStyle = '#e84118'; ctx.fillRect(-5.5, -17, 11, 2.5); break;
      case 'bun': ctx.fillStyle = '#2d1b10'; ctx.beginPath(); ctx.arc(0, -20, 3.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(0, -15.5, 5.6, Math.PI, 0); ctx.fill(); break;
      case 'cap': ctx.fillStyle = o.hatColor || '#0652dd'; ctx.beginPath(); ctx.arc(0, -15.5, 5.5, Math.PI, 0); ctx.fill(); ctx.fillRect(0, -16, flip * 8, 2); break;
      case 'beanie': ctx.fillStyle = o.hatColor || '#2f3542'; ctx.beginPath(); ctx.arc(0, -16, 5.6, Math.PI, 0); ctx.fill(); break;
      case 'cowboy': ctx.fillStyle = '#8c6239'; ctx.fillRect(-9, -18, 18, 2.5); ctx.fillRect(-4.5, -23, 9, 5.5); break;
      case 'glasses': ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.strokeRect(-4, -16, 3.5, 2.5); ctx.strokeRect(0.5, -16, 3.5, 2.5); break;
      case 'hardhat': ctx.fillStyle = '#f9ca24'; ctx.beginPath(); ctx.arc(0, -16, 6, Math.PI, 0); ctx.fill(); ctx.fillRect(-7, -16.5, 14, 2); break;
      case 'ponytail': ctx.fillStyle = '#6d4c41'; ctx.beginPath(); ctx.arc(0, -15.5, 5.6, Math.PI, 0); ctx.fill(); ctx.fillRect(-flip * 6 - 1.5, -16, 3, 8); break;
      case 'bald': ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, -12); ctx.lineTo(3, -12); ctx.stroke(); break;
    }
  }
  function drawProp(o, hx, hy, aim, flip) {
    ctx.save(); ctx.translate(hx, hy);
    const p = o.prop;
    if (p === 'mop' || p === 'broom') {
      let a = -Math.PI / 2 + flip * 0.5;
      if (o.swing > 0) a = aim + (o.swing / 0.32 - 0.5) * 2.4 * flip;
      ctx.rotate(a + Math.PI / 2);
      ctx.strokeStyle = '#a0522d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -20); ctx.stroke();
      if (p === 'mop') { ctx.strokeStyle = '#dfe4ea'; ctx.lineWidth = 1.5; for (let i = -4; i <= 4; i += 2) { ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(i * 1.4, -28); ctx.stroke(); } }
      else { ctx.fillStyle = '#e1b12c'; ctx.beginPath(); ctx.moveTo(-6, -27); ctx.lineTo(6, -27); ctx.lineTo(3, -20); ctx.lineTo(-3, -20); ctx.fill(); }
    } else if (p === 'wrench') {
      ctx.rotate(aim); ctx.fillStyle = '#95a5a6'; ctx.fillRect(0, -1.5, 11, 3); ctx.beginPath(); ctx.arc(12, 0, 3.5, 0, 7); ctx.fill();
    } else if (p === 'notebook') {
      ctx.fillStyle = '#2980b9'; ctx.fillRect(-1, -4, 7, 9); ctx.fillStyle = '#fff'; ctx.fillRect(0, -3, 5, 1);
    } else if (p === 'finger') {
      ctx.strokeStyle = o.line || '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(aim) * (o.point > 0 ? 9 : 4), Math.sin(aim) * (o.point > 0 ? 9 : 4)); ctx.stroke();
      if (o.point > 0) { ctx.fillStyle = '#ff9f1a'; ctx.beginPath(); ctx.arc(Math.cos(aim) * 11, Math.sin(aim) * 11, 2.5, 0, 7); ctx.fill(); }
    } else if (p === 'ruler') {
      const a = o.swing > 0 ? aim + (o.swing / 0.32 - 0.5) * 2.2 * flip : -0.6 * flip + Math.sin(o.smack || 0) * 0.5;
      ctx.rotate(a); ctx.fillStyle = '#f6e58d'; ctx.fillRect(0, -1.8, 20, 3.6); ctx.fillStyle = '#333'; for (let i = 3; i < 20; i += 3) ctx.fillRect(i, -1.8, 0.8, 1.6);
    } else if (p === 'stapler') {
      ctx.rotate(aim); ctx.fillStyle = '#2d3436'; ctx.fillRect(-1, -2.5, 10, 5); ctx.fillStyle = '#d63031'; ctx.fillRect(-1, -2.5, 10, 1.5);
    } else if (p) drawWeaponIcon(p, aim);
    ctx.restore();
  }
  function drawWeaponIcon(p, aim) {
    if (p === 'banana' || p === 'bunch') { ctx.rotate(aim); ctx.strokeStyle = '#f9ca24'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(3, 3, 5, -2.2, -0.4); ctx.stroke(); }
    else if (p === 'egg') { ctx.fillStyle = '#fffbe6'; ctx.beginPath(); ctx.ellipse(2, 0, 3, 4, 0, 0, 7); ctx.fill(); }
    else if (p === 'bottle') { ctx.rotate(aim - 1); ctx.fillStyle = '#8e5b2a'; ctx.fillRect(-2, -3, 5, 9); ctx.fillRect(-0.5, -7, 2, 4); }
    else if (p === 'cig') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, -1); ctx.stroke(); ctx.fillStyle = '#ff6b00'; ctx.fillRect(5, -2, 2, 2); }
  }

  const ENEMY_LOOK = {
    f: { look: 'cap', hatColor: '#e1b12c' }, m: { look: 'hardhat' }, c: { look: 'glasses', lanyard: true }, s: { look: 'ponytail', lanyard: true },
    a: { look: 'glasses', lanyard: true, tie: false }, A: { look: 'bald', tie: true, lanyard: true },
  };
  const PROPS = { m: 'wrench', c: 'notebook', s: 'finger', a: 'ruler', A: 'stapler' };

  function drawEnemy(e) {
    if (e.type === 'K') { drawBoss(e); return; }
    const L = ENEMY_LOOK[e.type];
    let x = e.x, y = e.y;
    if (e.burning > 0) { x += Math.sin(G.time * 40) * 1.5; }
    stick(x, y, {
      facing: e.facing, walk: e.walk, shirt: e.burning > 0 ? '#2d3436' : '#dfe6e9', vest: e.burning > 0 ? '#2d3436' : e.def.vest, line: e.burning > 0 ? '#2d3436' : '#111',
      flash: e.flash, look: L.look, hatColor: L.hatColor, lanyard: L.lanyard, tie: L.tie,
      prop: e.burning > 0 ? null : (e.prop || PROPS[e.type]), swing: e.swing, smack: e.smack, point: e.point, aimAng: e.burning > 0 ? -Math.PI / 2 + Math.sin(G.time * 30) : e.facing,
      scale: 1.12,
    });
    if (e.point > 0) e.point -= 1 / 60;
    if (e.burning > 0) return;
    // name tag + hp
    ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
    const tw = ctx.measureText(e.def.role).width + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - tw / 2, y - 37, tw, 10);
    ctx.fillStyle = e.def.vest; ctx.fillText(e.def.role, x, y - 29.5);
    if (e.hp < e.max) { ctx.fillStyle = '#2d3436'; ctx.fillRect(x - 12, y - 26, 24, 3); ctx.fillStyle = '#ff4757'; ctx.fillRect(x - 12, y - 26, 24 * Math.max(0, e.hp) / e.max, 3); }
  }

  function drawBoss(e) {
    const s = 2.3, x = e.x, y = e.y - 10;
    if (e.shield && e.burning <= 0) {
      ctx.save(); ctx.globalAlpha = 0.25 + Math.sin(G.time * 5) * 0.08; ctx.fillStyle = '#74b9ff'; ctx.beginPath(); ctx.arc(x, y - 6, 46, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.8; ctx.strokeStyle = '#74b9ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const burnt = e.burning > 0, flip = Math.cos(e.facing) < 0 ? -1 : 1, sw = Math.sin(e.walk);
    const line = e.flash > 0 ? '#ff4757' : burnt ? '#2d3436' : '#111';
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, 13, 12, 3.5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(-5 + sw * 3, 13); ctx.moveTo(2, 3); ctx.lineTo(5 - sw * 3, 13); ctx.stroke();
    // big belly in a loud aloha shirt
    ctx.fillStyle = burnt ? '#2d3436' : '#e84393'; ctx.beginPath(); ctx.ellipse(0, -3, 9, 8.5, 0, 0, 7); ctx.fill(); ctx.stroke();
    if (!burnt) { ctx.fillStyle = '#fdcb6e'; [[-4, -6], [3, -1], [-2, 2], [5, -7], [-6, 0]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a, b, 1.6, 0, 7); ctx.fill(); }); }
    ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(-12, e.point > 0 ? -12 : -1); ctx.moveTo(7, -7); ctx.lineTo(12 * flip > 0 ? 13 : 11, -3); ctx.stroke();
    ctx.fillStyle = burnt ? '#636e72' : '#fff'; ctx.beginPath(); ctx.arc(0, -15, 6, 0, 7); ctx.fill(); ctx.stroke();
    if (!burnt) {
      ctx.fillStyle = '#111'; ctx.fillRect(-5, -17, 4.5, 2.5); ctx.fillRect(0.5, -17, 4.5, 2.5); ctx.fillRect(-1, -16.5, 2, 1); // shades
      ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.moveTo(-5, -20); ctx.lineTo(-5, -25); ctx.lineTo(-2.5, -22); ctx.lineTo(0, -26); ctx.lineTo(2.5, -22); ctx.lineTo(5, -25); ctx.lineTo(5, -20); ctx.closePath(); ctx.fill(); // crown
      ctx.fillStyle = '#ff7675'; for (let i = -4; i <= 4; i += 2) { ctx.beginPath(); ctx.arc(i, -9 + Math.abs(i) * -0.2, 1.4, 0, 7); ctx.fill(); } // lei
    }
    ctx.restore();
    if (e.point > 0) e.point -= 1 / 60;
  }

  function drawPlayer() {
    if (P.invuln > 0 && Math.floor(G.time * 15) % 2 && P.invuln < 2) return;
    const d = G.def, w = d.weapons[G.weapon];
    stick(P.x, P.y, { facing: P.facing, aimAng: P.aim, walk: P.walk, moving: P.moving, shirt: d.shirt, dress: G.cls === 'bev', look: d.look, flash: P.flash, prop: P.puff > 0 ? null : w, scale: 1.15 });
    if (P.puff > 0) { ctx.fillStyle = '#ff6b00'; ctx.beginPath(); ctx.arc(P.x + Math.cos(P.aim) * 9, P.y - 22, 3, 0, 7); ctx.fill(); }
    // aim reticle (desktop)
    if (!isTouch && mouse.active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(P.x + Math.cos(P.aim) * 20, P.y - 6 + Math.sin(P.aim) * 20); ctx.lineTo(P.x + Math.cos(P.aim) * 70, P.y - 6 + Math.sin(P.aim) * 70); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  function drawHelper(h, alpha) {
    ctx.save(); if (alpha !== undefined) ctx.globalAlpha = alpha;
    stick(h.x, h.y, { facing: h.facing, walk: h.walk, shirt: h.shirt, look: h.hat, hatColor: h.shirt, flash: h.flash, prop: 'banana', scale: 1.0 });
    ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#7bed9f'; ctx.fillText(h.name, h.x, h.y - 26);
    ctx.restore();
  }

  function drawProj(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    switch (p.kind) {
      case 'banana':
        ctx.strokeStyle = '#f9ca24'; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 4, 7, -2.6, -0.5); ctx.stroke();
        ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 4, 7, -2.75, -2.6); ctx.stroke(); break;
      case 'egg': ctx.fillStyle = '#fffbe6'; ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 0, 4, 5.5, 0, 0, 7); ctx.fill(); ctx.stroke(); break;
      case 'bottle': ctx.fillStyle = '#8e5b2a'; ctx.fillRect(-3, -4, 6, 11); ctx.fillRect(-1.2, -9, 2.4, 5); ctx.fillStyle = '#ffeaa7'; ctx.fillRect(-3, -1, 6, 4); break;
      case 'cig': ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(4, 0); ctx.stroke(); ctx.fillStyle = '#ff6b00'; ctx.beginPath(); ctx.arc(5, 0, 2.2, 0, 7); ctx.fill(); break;
      case 'wrench': ctx.fillStyle = '#95a5a6'; ctx.fillRect(-8, -2, 14, 4); ctx.beginPath(); ctx.arc(7, 0, 4.5, 0, 7); ctx.fill(); ctx.fillStyle = '#2d3436'; ctx.fillRect(8, -1.5, 4, 3); break;
      case 'notebook': ctx.fillStyle = '#2980b9'; ctx.fillRect(-6, -7, 12, 14); ctx.fillStyle = '#fff'; ctx.fillRect(-4, -5, 9, 10); ctx.fillStyle = '#2980b9'; for (let i = -3; i < 5; i += 2.5) ctx.fillRect(-3, i, 7, 0.8); break;
      case 'bb': ctx.fillStyle = '#2d3436'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill(); ctx.fillStyle = '#b2bec3'; ctx.fillRect(-1, -1.5, 1.2, 1.2); break;
      case 'firebb': ctx.fillStyle = '#ffd32a'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill(); ctx.fillStyle = '#ff3f34'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill(); break;
      case 'stapler': ctx.fillStyle = '#2d3436'; ctx.fillRect(-7, -3, 14, 6); ctx.fillStyle = '#d63031'; ctx.fillRect(-7, -3, 14, 2); break;
      case 'pen': ctx.rotate(-p.rot + Math.atan2(p.vy, p.vx)); ctx.fillStyle = '#0652dd'; ctx.fillRect(-7, -1.2, 12, 2.4); ctx.fillStyle = '#dfe6e9'; ctx.beginPath(); ctx.moveTo(5, -1.2); ctx.lineTo(8, 0); ctx.lineTo(5, 1.2); ctx.fill(); break;
    }
    ctx.restore();
  }
  function drawDecal(d) {
    ctx.save(); ctx.translate(d.x, d.y);
    if (d.type === 'ash') {
      ctx.fillStyle = 'rgba(30,30,30,0.75)'; ctx.beginPath(); ctx.ellipse(0, 0, d.r * 1.1, d.r * 0.55, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(90,90,90,0.8)'; for (let i = 0; i < 6; i++) ctx.fillRect(Math.cos(i + d.seed * 9) * d.r * 0.7, Math.sin(i * 2 + d.seed) * d.r * 0.3, 2.5, 2.5);
    } else if (d.type === 'peel') {
      ctx.rotate(d.rot); ctx.fillStyle = '#f6d55c'; for (let i = 0; i < 3; i++) { ctx.save(); ctx.rotate(i * 2.1); ctx.beginPath(); ctx.ellipse(4, 0, 4, 1.8, 0, 0, 7); ctx.fill(); ctx.restore(); }
    } else if (d.type === 'egg') {
      ctx.fillStyle = 'rgba(255,255,240,0.85)'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 5, d.rot, 0, 7); ctx.fill(); ctx.fillStyle = '#f9ca24'; ctx.beginPath(); ctx.arc(1, 0, 2.6, 0, 7); ctx.fill();
    } else if (d.type === 'glass') {
      ctx.rotate(d.rot); ctx.fillStyle = 'rgba(142,91,42,0.8)'; for (let i = 0; i < 6; i++) ctx.fillRect(Math.cos(i * 1.7) * 8, Math.sin(i * 2.3) * 5, 3, 2);
      ctx.fillStyle = 'rgba(230,200,60,0.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function drawDoors() {
    for (const ex of Z.exits) {
      const px = ex.x * TILE, py = ex.y * TILE;
      if (Z.doorOpen) {
        ctx.fillStyle = `rgba(46,213,115,${0.55 + Math.sin(G.time * 6) * 0.2})`; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(Z.def.boss ? 'OUT' : 'GO', px + 16, py + 20);
      } else {
        ctx.fillStyle = '#5d4037'; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#c0392b'; for (let i = 4; i < TILE; i += 8) ctx.fillRect(px + i, py, 3, TILE);
        ctx.fillStyle = Math.sin(G.time * 4) > 0 ? '#ff4757' : '#8b0000'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 3, 0, 7); ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- camera + frame
  const cam = { x: 0, y: 0 };
  function resizeZoom() {
    if (!Z) return;
    const fit = Math.min(W / Z.pw, (H - 10) / Z.ph);
    zoom = fit >= 0.95 ? Math.min(fit, 2.2) : clamp(Math.min(W, H) / (12 * TILE), 0.8, 1.4);
  }
  function screenToWorld(sx, sy) { return { x: sx / zoom + cam.x, y: sy / zoom + cam.y }; }
  function updateCam() {
    const vw = W / zoom, vh = H / zoom;
    cam.x = Z.pw <= vw ? (Z.pw - vw) / 2 : clamp(P.x - vw / 2, 0, Z.pw - vw);
    cam.y = Z.ph <= vh ? (Z.ph - vh) / 2 : clamp(P.y - vh / 2, 0, Z.ph - vh);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#141418'; ctx.fillRect(0, 0, W, H);
    if (!Z) return;
    updateCam();
    const sx = shake ? rand(-shake, shake) * 0.5 : 0, sy = shake ? rand(-shake, shake) * 0.5 : 0;
    ctx.setTransform(DPR * zoom, 0, 0, DPR * zoom, (-cam.x * zoom + sx) * DPR, (-cam.y * zoom + sy) * DPR);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(Z.bg, 0, 0);
    Z.decals.forEach(drawDecal);
    drawDoors();
    for (const h of Z.hazards) { ctx.fillStyle = `rgba(255,120,0,${0.35 * h.life / h.max})`; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, 7); ctx.fill(); }
    // y-sorted actors
    const actors = [];
    Z.enemies.forEach((e) => actors.push({ y: e.y, f: () => drawEnemy(e) }));
    G.helpers.forEach((h) => actors.push({ y: h.y, f: () => drawHelper(h) }));
    Z.fading.forEach((fd) => actors.push({ y: fd.ent.y, f: () => drawHelper(fd.ent, fd.t / 1.4) }));
    actors.push({ y: P.y, f: drawPlayer });
    actors.sort((a, b) => a.y - b.y).forEach((a) => a.f());
    Z.proj.forEach(drawProj);
    // particles
    for (const q of Z.parts) {
      const a = clamp(q.life / q.max, 0, 1);
      if (q.type === 'fire') { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a; ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.4 + a * 0.6), 0, 7); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
      else if (q.type === 'smoke') { ctx.globalAlpha = a * 0.45; ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (2 - a), 0, 7); ctx.fill(); }
      else { ctx.globalAlpha = a; ctx.fillStyle = q.color; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); }
    }
    ctx.globalAlpha = 1;
    // texts + speech bubbles
    for (const t of Z.texts) {
      const a = clamp(t.life / Math.min(0.4, t.max), 0, 1);
      ctx.globalAlpha = a;
      if (t.bubble) {
        const e = t.follow; const bx = e.x, by = e.y - (e.type === 'K' ? 82 : 46);
        ctx.font = 'bold ' + t.size + 'px sans-serif'; ctx.textAlign = 'center';
        const tw = ctx.measureText(t.t).width + 10;
        ctx.fillStyle = e.burning > 0 ? '#ffeaa7' : '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
        roundRect(bx - tw / 2, by - 13, tw, 18, 6); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx - 3, by + 5); ctx.lineTo(bx, by + 10); ctx.lineTo(bx + 3, by + 5); ctx.fill();
        ctx.fillStyle = e.burning > 0 ? '#d63031' : '#111'; ctx.fillText(t.t, bx, by);
      } else {
        ctx.font = 'bold ' + t.size + 'px Impact, "Arial Black", sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(t.t, t.x, t.y); ctx.fillStyle = t.color; ctx.fillText(t.t, t.x, t.y);
      }
    }
    ctx.globalAlpha = 1;
    // screen space
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawHUD();
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawHUD() {
    const u = clamp(Math.min(W, H) / 420, 0.75, 1.4);
    const pad = 10 * u;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // panel
    const left = Z.enemies.filter((e) => !e.burning).length;
    const zoneLine = `ZONE ${Z.idx + 1}/7 · ${Z.def.name} · STAFF LEFT ${left}`;
    ctx.font = `${9 * u}px sans-serif`;
    const panelW = Math.max(210 * u, ctx.measureText(zoneLine).width + 18 * u);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(pad, pad, panelW, 74 * u, 8 * u); ctx.fill();
    // lives
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < G.lives ? '#fff' : 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(pad + 14 * u + i * 16 * u, pad + 14 * u, 5.5 * u, 0, 7); ctx.fill();
    }
    // hp
    for (let i = 0; i < P.maxHp; i++) { ctx.fillStyle = i < P.hp ? '#ff4757' : 'rgba(255,71,87,0.2)'; ctx.fillRect(pad + 64 * u + i * 13 * u, pad + 9 * u, 10 * u, 10 * u); }
    ctx.font = `bold ${12 * u}px sans-serif`; ctx.fillStyle = '#ffd32a';
    ctx.fillText('POINTS ' + G.points, pad + 8 * u, pad + 38 * u);
    // next helper pips
    ctx.fillStyle = '#ccc'; ctx.font = `${9 * u}px sans-serif`; ctx.fillText('NEXT HELPER', pad + 100 * u, pad + 38 * u);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = i < G.prog ? '#7bed9f' : 'rgba(255,255,255,0.2)'; ctx.beginPath(); ctx.arc(pad + 167 * u + i * 8 * u, pad + 35 * u, 3 * u, 0, 7); ctx.fill(); }
    const th = throwers();
    ctx.font = `bold ${12 * u}px sans-serif`; ctx.fillStyle = th >= NEEDED_FOR_BOSS ? '#7bed9f' : '#fff';
    ctx.fillText('🍌 THROWERS ' + th + (Z.idx >= 4 && th < NEEDED_FOR_BOSS ? ' / ' + NEEDED_FOR_BOSS + ' needed' : ''), pad + 8 * u, pad + 58 * u);
    ctx.font = `${9 * u}px sans-serif`; ctx.fillStyle = '#aaa';
    ctx.fillText(zoneLine, pad + 8 * u, pad + 70 * u);
    // weapons (Ralph)
    const ws = G.def.weapons;
    if (ws.length > 1 || G.def.special) {
      const bx = pad, by = pad + 82 * u;
      ws.forEach((w, i) => {
        ctx.fillStyle = i === G.weapon ? 'rgba(255,211,42,0.9)' : 'rgba(0,0,0,0.55)'; roundRect(bx + i * 36 * u, by, 32 * u, 32 * u, 6 * u); ctx.fill();
        ctx.font = `${17 * u}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(WEAPONS[w].icon, bx + i * 36 * u + 16 * u, by + 22 * u);
        if (!isTouch) { ctx.font = `bold ${8 * u}px sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), bx + i * 36 * u + 27 * u, by + 10 * u); }
        ctx.textAlign = 'left';
      });
      if (G.def.special) {
        const fx = bx + ws.length * 36 * u, ready = P.special <= 0;
        ctx.fillStyle = ready ? 'rgba(255,99,72,0.9)' : 'rgba(0,0,0,0.55)'; roundRect(fx, by, 60 * u, 32 * u, 6 * u); ctx.fill();
        if (!ready) { ctx.fillStyle = 'rgba(255,99,72,0.5)'; ctx.fillRect(fx, by + 32 * u * (P.special / 3.2), 60 * u, 32 * u * (1 - P.special / 3.2)); }
        ctx.fillStyle = '#fff'; ctx.font = `bold ${10 * u}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('🔥 FART', fx + 30 * u, by + 15 * u); ctx.font = `${8 * u}px sans-serif`; ctx.fillText(isTouch ? 'button' : 'SPACE / R-click', fx + 30 * u, by + 26 * u);
        ctx.textAlign = 'left';
      }
    }
    // boss bar
    if (Z.boss && !Z.boss.dead && Z.boss.burning <= 0 && Z.bossIntro) {
      const bw = Math.min(W - 40, 420 * u), bx = (W - bw) / 2, by = H - 34 * u - (isTouch ? 0 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; roundRect(bx - 6, by - 18 * u, bw + 12, 34 * u, 6); ctx.fill();
      ctx.fillStyle = '#2d3436'; ctx.fillRect(bx, by, bw, 9 * u);
      ctx.fillStyle = Z.boss.shield ? '#74b9ff' : '#e84393'; ctx.fillRect(bx, by, bw * Z.boss.hp / Z.boss.max, 9 * u);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${11 * u}px Impact, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(Z.boss.shield ? 'THE BIG KAHUNA — SHIELDED: NEED 5 THROWERS' : 'THE BIG KAHUNA', W / 2, by - 4 * u);
      ctx.textAlign = 'left';
    }
    // exit arrow
    if (Z.doorOpen && Z.exits.length) {
      const ex = Z.exits[0], wx = ex.x * TILE + 16, wy = ex.y * TILE + 16;
      const s = { x: (wx - cam.x) * zoom, y: (wy - cam.y) * zoom };
      if (s.x < 0 || s.y < 0 || s.x > W || s.y > H) {
        const a = Math.atan2(s.y - H / 2, s.x - W / 2);
        const r = Math.min(W, H) / 2 - 40;
        const ax = W / 2 + Math.cos(a) * r, ay = H / 2 + Math.sin(a) * r;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a); ctx.fillStyle = '#2ed573'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    // banner
    if (Z.banner > 0) {
      const a = clamp(Z.banner / 0.5, 0, 1) * clamp((2.6 - Z.banner) / 0.3, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, H / 2 - 54 * u, W, 100 * u);
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffd32a'; ctx.font = `${13 * u}px Impact, "Arial Black", sans-serif`;
      ctx.fillText('ZONE ' + (Z.idx + 1), W / 2, H / 2 - 28 * u);
      ctx.fillStyle = '#fff'; ctx.font = `${Math.min(40 * u, W / 12)}px Impact, "Arial Black", sans-serif`; ctx.fillText(Z.def.name, W / 2, H / 2 + 8 * u);
      ctx.font = `${Math.min(12 * u, W / 34)}px sans-serif`; ctx.fillStyle = '#ddd'; ctx.fillText(Z.def.sub, W / 2, H / 2 + 32 * u);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    // touch sticks
    for (const k of ['move', 'aim']) {
      const s = sticks[k]; if (!s) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.ox, s.oy, 55, 0, 7); ctx.stroke();
      ctx.fillStyle = k === 'aim' ? 'rgba(255,211,42,0.6)' : 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(s.x, s.y, 24, 0, 7); ctx.fill();
    }
    if (isTouch && !sticks.move && !sticks.aim && G.time < 12) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `bold ${12 * u}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('LEFT THUMB: MOVE', W * 0.25, H - 24); ctx.fillText('RIGHT THUMB: AIM + THROW', W * 0.75, H - 24); ctx.textAlign = 'left';
    }
  }

  // ---------------------------------------------------------------- screens
  const screens = ['title', 'select', 'how', 'pause', 'over', 'win', 'kick'];
  function setState(s) {
    state = s;
    screens.forEach((n) => $('screen-' + n).classList.toggle('show', n === s));
    const playing = s === 'play';
    $('btn-pause').classList.toggle('hidden', !playing);
    $('touch-ui').classList.toggle('hidden', !(playing && isTouch));
    if (playing) { lastT = performance.now(); mouse.down = false; }
    updateTouchUI();
  }
  function updateTouchUI() {
    const ralph = G && G.def.special;
    $('btn-special').classList.toggle('hidden', !ralph);
    $('btn-swap').classList.toggle('hidden', !(G && G.def.weapons.length > 1));
    if (G && G.def.weapons.length > 1) $('btn-swap').textContent = WEAPONS[G.def.weapons[G.weapon]].icon + ' SWAP';
  }
  function bestScore() { return store.get('ru_best', 0); }
  function saveBest() { if (G.points > bestScore()) { store.set('ru_best', G.points); return true; } return false; }
  function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }
  function statsHTML(extra) {
    return `<div class="stats"><div><b>${G.points}</b><span>points</span></div><div><b>${G.kills}</b><span>staff burned</span></div><div><b>${throwers()}</b><span>throwers</span></div><div><b>${fmtTime(G.time)}</b><span>time</span></div></div>${extra || ''}`;
  }
  function gameOver(why) {
    const nb = saveBest();
    $('over-why').textContent = why + ' Made it to: ' + Z.def.name + '.';
    $('over-stats').innerHTML = statsHTML(nb ? '<p class="newbest">NEW BEST!</p>' : '');
    setState('over');
  }
  function victory() {
    const nb = saveBest();
    Sfx.win();
    $('win-stats').innerHTML = statsHTML(nb ? '<p class="newbest">NEW BEST!</p>' : '') + `<p class="fine">Played as ${G.def.name}.</p>`;
    setState('win');
  }
  function kickBack() {
    const n = throwers();
    $('kick-text').textContent = `"You and ${n === 1 ? 'nobody' : (n - 1) + ' friend' + (n === 2 ? '' : 's')}? That's adorable. Come back when you have FIVE people throwing bananas." — The Big Kahuna`;
    Sfx.boss();
    setState('kick');
  }

  function populateSelect() {
    const wrap = $('class-list'); wrap.innerHTML = '';
    Object.entries(CLASSES).forEach(([key, c]) => {
      const b = document.createElement('button');
      b.className = 'card' + (c.over ? ' over' : '');
      const bars = Object.entries(c.stats).map(([k, v]) => `<div class="bar"><span>${k}</span><i style="width:${v * 20}%"></i></div>`).join('');
      b.innerHTML = `<canvas width="80" height="80"></canvas><div class="info"><h3>${c.name}${c.over ? ' <em>OVER-AMPED</em>' : ''}</h3><p>${c.blurb}</p>${bars}<p class="arsenal">${c.weapons.map((w) => WEAPONS[w].icon).join(' ')}${c.special ? ' 🔥💨' : ''}</p></div>`;
      b.addEventListener('click', () => { Sfx.init(); newRun(key); });
      wrap.appendChild(b);
      // portrait
      const pc = b.querySelector('canvas'), g = pc.getContext('2d');
      ctxSwap(g, () => stick(40, 50, { facing: 0.3, aimAng: -0.4, walk: 0, moving: false, shirt: c.shirt, dress: key === 'bev', look: c.look, prop: c.weapons[c.weapons.length - 1], scale: 2.4 }));
    });
  }
  function ctxSwap(g, fn) { const real = ctx; ctx = g; try { fn(); } finally { ctx = real; } }

  // menu buttons
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    Sfx.init();
    const act = b.dataset.act;
    if (act === 'play') { populateSelect(); setState('select'); }
    else if (act === 'how') setState('how');
    else if (act === 'title') { $('best').textContent = bestScore(); setState('title'); }
    else if (act === 'resume') setState('play');
    else if (act === 'retry') newRun(G.cls);
    else if (act === 'mute') toggleMute();
    else if (act === 'kick-ok') {
      G.lives--;
      if (G.lives <= 0) { gameOver('The Big Kahuna sent you packing.'); return; }
      P.hp = P.maxHp;
      loadZone(ZONES.length - 2);
      setState('play');
      text(P.x, P.y - 40, 'GET MORE PEOPLE: ' + throwers() + ' / ' + NEEDED_FOR_BOSS, { color: '#ffd32a', size: 16, life: 3, max: 3 });
    } else if (act === 'install') doInstall();
  });
  $('btn-pause').addEventListener('click', () => setState('pause'));
  const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Sfx.init(); fn(); });
  tap($('btn-special'), () => { wantSpecial = true; });
  tap($('btn-swap'), () => setWeapon(G.weapon + 1));
  function toggleMute() { Sfx.setMuted(!Sfx.muted); document.querySelectorAll('[data-act="mute"]').forEach((b) => { b.textContent = Sfx.muted ? '🔇 SOUND OFF' : '🔊 SOUND ON'; }); }
  document.querySelectorAll('[data-act="mute"]').forEach((b) => { b.textContent = Sfx.muted ? '🔇 SOUND OFF' : '🔊 SOUND ON'; });
  addEventListener('blur', () => { if (state === 'play') setState('pause'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setState('pause'); });

  // install as an app
  let deferredPrompt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('btn-install').classList.remove('hidden'); });
  function doInstall() { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.finally(() => { deferredPrompt = null; $('btn-install').classList.add('hidden'); }); } }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('ios-hint').classList.remove('hidden');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // ---------------------------------------------------------------- main loop
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    resizeZoom();
  }
  addEventListener('resize', resize);
  resize();

  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    if (state === 'play' && G) update(dt);
    if (G && Z) render(); else { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#141418'; ctx.fillRect(0, 0, W, H); }
    requestAnimationFrame(frame);
  }
  $('best').textContent = bestScore();
  setState('title');
  requestAnimationFrame(frame);

  if (DEBUG) window.__ru = { get G() { return G; }, get Z() { return Z; }, get P() { return P; }, get state() { return state; }, newRun, addHelper, nextZone, loadZone, setState, keys, mouse };
})();
