/* ============================================================================
   Shadow Step — an endless ninja runner for mobile.
   Three lanes, pseudo-3D perspective, swipe controls, no dependencies.
   ========================================================================== */
(function () {
  'use strict';

  /* ───────────────────────── Tuning ───────────────────────── */
  var CFG = {
    laneW: 1.35,         // world units between lane centers
    playerZ: 6.8,        // player's distance in front of the camera
    camY: 3.5,           // camera height above the road
    horizonFrac: 0.30,   // horizon position as a fraction of canvas height
    focalFrac: 0.88,     // focal length as a fraction of canvas height
    drawDist: 95,        // furthest z we spawn / draw
    gravity: -36,
    jumpV: 12.2,         // ~2.06 units of apex
    coyote: 0.09,
    bufferTime: 0.16,    // input buffering window
    rollTime: 0.56,
    laneTime: 0.13,
    startSpeed: 11,
    maxSpeed: 30,
    accel: 0.26,         // speed gained per second of running
    playerW: 0.8,
    playerH: 1.75,
    rollH: 0.95,
    invuln: 1.5,
    lives: 3,
    enemyFrom: 400,      // metres of running before the first thrower shows up
    enemyScoreFrom: 500, // and this much score on the board
    throwWindup: 0.6,    // telegraph time before a star leaves the hand
    starSpeed: 17,       // closing speed on top of the world scroll
    starR: 0.22,
    starHigh: 1.3,       // duck under it
    starLow: 0.42,       // jump over it
    magnetTime: 8,
    shieldTime: 12,
    doubleTime: 12,
    dashTime: 4.5,
    dashBoost: 1.45
  };

  var OBSTACLES = {
    // h: height, len: depth along z, w: width, top: standable surface height
    crate: { h: 0.95, len: 1.2, w: 1.16, top: 0.95, clear: 'jump' },
    gate:  { h: 2.45, len: 0.55, w: 1.22, low: 1.02, clear: 'roll' },
    wall:  { h: 2.75, len: 0.85, w: 1.22, clear: 'lane' },
    cart:  { h: 1.6, len: 8.5, w: 1.24, top: 1.6, clear: 'lane' }
  };

  var POWERS = {
    magnet: { icon: '🧲', label: 'Magnet', color: '#6ef7c1', time: CFG.magnetTime },
    shield: { icon: '🛡️', label: 'Shield', color: '#7eb8ff', time: CFG.shieldTime },
    double: { icon: '✨', label: 'Double', color: '#ff6b8b', time: CFG.doubleTime },
    dash:   { icon: '⚡', label: 'Dash',   color: '#ffcf5c', time: CFG.dashTime }
  };

  // Each biome swaps the palette every ~900 m so long runs keep changing.
  var BIOMES = [
    { name: 'Moonlit Village', sky: ['#2b1a4d', '#4b2a63', '#7a4470'], road: '#2a2140', roadAlt: '#322748',
      rail: '#6ef7c1', fog: '#3a2458', hill: '#1d1235', prop: '#3b2a55', glow: '#ffcf5c' },
    { name: 'Bamboo Grove', sky: ['#062a2a', '#0e4740', '#2a7d5c'], road: '#1b3030', roadAlt: '#213a37',
      rail: '#ffcf5c', fog: '#124038', hill: '#0b2320', prop: '#1f4a3c', glow: '#b7f77a' },
    { name: 'Snow Temple', sky: ['#1b2749', '#39507f', '#8ea6d6'], road: '#2e3a56', roadAlt: '#37445f',
      rail: '#ff6b8b', fog: '#42548a', hill: '#22304f', prop: '#44557d', glow: '#ffffff' },
    { name: 'Lantern Festival', sky: ['#3d1030', '#701f3c', '#c2543f'], road: '#331d34', roadAlt: '#3c243b',
      rail: '#ffe08a', fog: '#5a2440', hill: '#2a1226', prop: '#50263f', glow: '#ff9a5c' }
  ];

  /* ───────────────────────── Helpers ───────────────────────── */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function chance(p) { return Math.random() < p; }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixHex(a, b, t) {
    var ca = hexToRgb(a), cb = hexToRgb(b);
    return 'rgb(' + Math.round(lerp(ca[0], cb[0], t)) + ',' + Math.round(lerp(ca[1], cb[1], t)) +
      ',' + Math.round(lerp(ca[2], cb[2], t)) + ')';
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* ───────────────────────── Persistence ───────────────────────── */
  var Store = {
    key: 'shadowstep.v1',
    data: { best: 0, coins: 0, runs: 0, far: 0, sound: true, name: '', rival: null },
    load: function () {
      try {
        var raw = localStorage.getItem(this.key);
        if (raw) {
          var parsed = JSON.parse(raw);
          for (var k in this.data) if (Object.prototype.hasOwnProperty.call(parsed, k)) this.data[k] = parsed[k];
        }
      } catch (e) { /* private mode — run with defaults */ }
      return this.data;
    },
    save: function () {
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    }
  };
  Store.load();

  /* ───────────────────────── Audio (tiny WebAudio synth) ───────────────────────── */
  var Audio2 = {
    ctx: null,
    on: Store.data.sound !== false,
    init: function () {
      if (this.ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
    },
    resume: function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    blip: function (freq, dur, type, vol, slideTo) {
      if (!this.on || !this.ctx) return;
      var t = this.ctx.currentTime;
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    noise: function (dur, vol) {
      if (!this.on || !this.ctx) return;
      var rate = this.ctx.sampleRate;
      var len = Math.floor(rate * dur);
      var buf = this.ctx.createBuffer(1, len, rate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = this.ctx.createBufferSource();
      var gain = this.ctx.createGain();
      gain.gain.value = vol || 0.12;
      src.buffer = buf;
      src.connect(gain).connect(this.ctx.destination);
      src.start();
    },
    play: function (name) {
      if (!this.on) return;
      this.init();
      this.resume();
      switch (name) {
        case 'coin':   this.blip(1180, 0.08, 'triangle', 0.1, 1760); break;
        case 'jump':   this.blip(380, 0.13, 'sine', 0.11, 720); break;
        case 'land':   this.noise(0.08, 0.05); break;
        case 'roll':   this.noise(0.16, 0.07); break;
        case 'lane':   this.blip(620, 0.05, 'sine', 0.05, 760); break;
        case 'hit':    this.blip(220, 0.28, 'sawtooth', 0.14, 70); this.noise(0.2, 0.12); break;
        case 'power':  this.blip(520, 0.1, 'triangle', 0.12, 880);
                       var self = this; setTimeout(function () { self.blip(880, 0.16, 'triangle', 0.1, 1320); }, 90); break;
        case 'shieldbreak': this.blip(700, 0.22, 'sine', 0.12, 240); break;
        case 'throw':  this.noise(0.14, 0.07); this.blip(880, 0.12, 'sawtooth', 0.07, 420); break;
        case 'start':  this.blip(440, 0.1, 'triangle', 0.1, 660); break;
        case 'over':   this.blip(400, 0.5, 'sawtooth', 0.12, 90); break;
      }
    },
    toggle: function () {
      this.on = !this.on;
      Store.data.sound = this.on;
      Store.save();
      if (this.on) this.play('start');
      return this.on;
    }
  };

  /* ───────────────────────── Canvas & projection ───────────────────────── */
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var view = { w: 0, h: 0, dpr: 1, cx: 0, horizon: 0, focal: 0 };

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.w = w;
    view.h = h;
    view.dpr = dpr;
    view.cx = w / 2;
    view.horizon = h * CFG.horizonFrac;
    // A tall, narrow phone needs a longer focal length than a wide window.
    view.focal = Math.min(h * CFG.focalFrac, w * 1.55);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

  // World → screen. z is distance ahead of the camera, y is height above the road.
  function projX(x, z, s) { return view.cx + x * s; }
  function projY(y, s) { return view.horizon + (CFG.camY - y) * s; }
  function scaleAt(z) { return view.focal / Math.max(z, 0.4); }
  function laneX(i) { return (i - 1) * CFG.laneW; }

  /* ───────────────────────── Game state ───────────────────────── */
  var STATE = { MENU: 'menu', PLAY: 'play', PAUSE: 'pause', OVER: 'over' };

  var G = {
    state: STATE.MENU,
    time: 0,
    speed: CFG.startSpeed,
    distance: 0,
    worldZ: 0,       // total travelled distance, drives scrolling textures
    score: 0,
    coins: 0,
    lives: CFG.lives,
    entities: [],
    scenery: [],
    particles: [],
    floaters: [],    // floating "+10" score pops
    spawnZ: 0,
    scenerySpawnZ: 0,
    biome: 0,
    biomePrev: 0,
    biomeMix: 0,
    shake: 0,
    flash: 0,
    powers: { magnet: 0, shield: 0, double: 0, dash: 0 },
    newBest: false,
    rivalBeaten: false
  };

  var player = {
    lane: 1,
    lanePos: 1,       // tweened lane position for smooth strafing
    laneFrom: 1,
    laneT: 1,
    y: 0,
    vy: 0,
    onGround: true,
    groundY: 0,
    rolling: 0,
    invuln: 0,
    runPhase: 0,
    leanTarget: 0,
    lean: 0,
    coyote: 0,
    platform: null    // cart we are standing on, if any
  };

  function resetRun() {
    G.time = 0;
    G.speed = CFG.startSpeed;
    G.distance = 0;
    G.worldZ = 0;
    G.score = 0;
    G.coins = 0;
    G.lives = CFG.lives;
    G.entities.length = 0;
    G.scenery.length = 0;
    G.particles.length = 0;
    G.floaters.length = 0;
    G.spawnZ = 46;
    G.scenerySpawnZ = 10;
    G.biome = 0;
    G.biomePrev = 0;
    G.biomeMix = 1;
    G.shake = 0;
    G.flash = 0;
    G.newBest = false;
    G.rivalBeaten = false;
    G.powers.magnet = G.powers.shield = G.powers.double = G.powers.dash = 0;

    player.lane = player.lanePos = player.laneFrom = 1;
    player.laneT = 1;
    player.y = 0;
    player.vy = 0;
    player.onGround = true;
    player.groundY = 0;
    player.rolling = 0;
    player.invuln = 0;
    player.runPhase = 0;
    player.lean = player.leanTarget = 0;
    player.coyote = 0;
    player.platform = null;

    for (var z = 12; z < CFG.drawDist; z += rand(6, 12)) addScenery(z);
  }

  /* ───────────────────────── Input ───────────────────────── */
  var input = { jumpBuffer: 0, rollBuffer: 0 };

  function moveLane(dir) {
    if (G.state !== STATE.PLAY) return;
    var target = clamp(player.lane + dir, 0, 2);
    if (target === player.lane) {
      player.leanTarget = dir * 0.35; // nudge against the wall
      return;
    }
    player.laneFrom = player.lanePos;
    player.lane = target;
    player.laneT = 0;
    player.leanTarget = dir;
    Audio2.play('lane');
  }

  function doJump() {
    if (G.state !== STATE.PLAY) return;
    if (player.rolling > 0) player.rolling = 0;
    if (player.onGround || player.coyote > 0) {
      player.vy = CFG.jumpV;
      player.onGround = false;
      player.coyote = 0;
      player.platform = null;
      input.jumpBuffer = 0;
      Audio2.play('jump');
      puff(4, 0.5);
    } else {
      input.jumpBuffer = CFG.bufferTime;
    }
  }

  function doRoll() {
    if (G.state !== STATE.PLAY) return;
    if (!player.onGround) {
      // Slam down out of a jump, then roll on landing.
      player.vy = Math.min(player.vy, -16);
      input.rollBuffer = CFG.bufferTime;
      return;
    }
    if (player.rolling <= 0) {
      player.rolling = CFG.rollTime;
      Audio2.play('roll');
      puff(5, 0.4);
    }
  }

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { moveLane(-1); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { moveLane(1); e.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') {
      if (G.state === STATE.MENU || G.state === STATE.OVER) startRun(); else doJump();
      e.preventDefault();
    } else if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'Shift') { doRoll(); e.preventDefault(); }
    else if (k === 'p' || k === 'P' || k === 'Escape') { togglePause(); e.preventDefault(); }
    else if (k === 'Enter') {
      if (G.state === STATE.MENU || G.state === STATE.OVER) startRun();
      else if (G.state === STATE.PAUSE) togglePause();
      e.preventDefault();
    } else if (k === 'm' || k === 'M') { toggleSound(); }
  });

  var touch = { active: false, x: 0, y: 0, t: 0, used: false };
  var SWIPE = 26;

  function pointerDown(e) {
    if (e.target.closest && e.target.closest('button')) return;
    var p = e.touches ? e.touches[0] : e;
    touch.active = true;
    touch.used = false;
    touch.x = p.clientX;
    touch.y = p.clientY;
    touch.t = performance.now();
  }

  function pointerMove(e) {
    if (!touch.active || touch.used) return;
    var p = e.touches ? e.touches[0] : e;
    var dx = p.clientX - touch.x;
    var dy = p.clientY - touch.y;
    if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) return;
    touch.used = true;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) doJump();
    else doRoll();
    if (e.cancelable) e.preventDefault();
  }

  function pointerUp(e) {
    if (!touch.active) return;
    touch.active = false;
    if (touch.used) return;
    // A quick tap: start the run, or jump.
    if (G.state === STATE.PLAY) doJump();
  }

  canvas.addEventListener('touchstart', pointerDown, { passive: true });
  canvas.addEventListener('touchmove', pointerMove, { passive: false });
  canvas.addEventListener('touchend', pointerUp, { passive: true });
  canvas.addEventListener('touchcancel', function () { touch.active = false; }, { passive: true });
  canvas.addEventListener('mousedown', pointerDown);
  window.addEventListener('mousemove', pointerMove);
  window.addEventListener('mouseup', pointerUp);
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && G.state === STATE.PLAY) togglePause();
  });

  /* ───────────────────────── Spawning ───────────────────────── */
  function makeObstacle(type, lane, z) {
    var def = OBSTACLES[type];
    return {
      kind: 'obstacle', type: type, lane: lane, x: laneX(lane), z: z, zPrev: z,
      h: def.h, len: def.len, w: def.w, top: def.top || 0, low: def.low || 0,
      clear: def.clear, seed: Math.random() * 6.28, broken: 0
    };
  }

  function makeCoin(lane, z, y) {
    return { kind: 'coin', lane: lane, x: laneX(lane), z: z, zPrev: z, y: y == null ? 1.0 : y,
      r: 0.42, taken: false, spin: Math.random() * 6.28, vx: 0, vy: 0 };
  }

  function makeEnemy(z, side) {
    return {
      kind: 'enemy', side: side, x: side * rand(2.6, 3.2), z: z, zPrev: z,
      throwZ: rand(30, 40), windup: 0, thrown: false, throwAnim: 0,
      aimLane: -1, seed: Math.random() * 6.28
    };
  }

  function makeStar(fromX, fromY, z, targetLane, low) {
    return {
      kind: 'star', x: fromX, y: fromY, x0: fromX, y0: fromY, z: z, zPrev: z,
      zStart: z, zEnd: CFG.playerZ + 2.2,
      targetX: laneX(targetLane), targetY: low ? CFG.starLow : CFG.starHigh,
      r: CFG.starR, low: low, spin: Math.random() * 6.28, dodged: false
    };
  }

  function countEnemies() {
    var n = 0;
    for (var i = 0; i < G.entities.length; i++) if (G.entities[i].kind === 'enemy') n++;
    return n;
  }

  function makePower(type, lane, z) {
    return { kind: 'power', type: type, lane: lane, x: laneX(lane), z: z, zPrev: z,
      y: 1.25, r: 0.6, taken: false, spin: Math.random() * 6.28 };
  }

  // Coin arcs: straight runs, jump arcs over crates, and lane-hopping zigzags.
  function coinLine(lane, z, count, step) {
    for (var i = 0; i < count; i++) G.entities.push(makeCoin(lane, z + i * (step || 1.7)));
  }

  function coinArc(lane, z, count, peak) {
    var span = (count - 1) || 1;
    for (var i = 0; i < count; i++) {
      var t = i / span;
      var y = 0.85 + Math.sin(t * Math.PI) * (peak || 1.15);
      G.entities.push(makeCoin(lane, z + i * 1.7, y));
    }
  }

  function coinZigzag(z, count) {
    var lane = randInt(0, 2);
    for (var i = 0; i < count; i++) {
      G.entities.push(makeCoin(lane, z + i * 1.8));
      if (i % 3 === 2) lane = clamp(lane + pick([-1, 1]), 0, 2);
    }
  }

  function shuffledLanes() {
    var l = [0, 1, 2];
    for (var i = l.length - 1; i > 0; i--) {
      var j = randInt(0, i);
      var t = l[i]; l[i] = l[j]; l[j] = t;
    }
    return l;
  }

  /* Difficulty rises with distance: 0 (gentle) → 1 (busy). */
  function difficulty() { return clamp(G.distance / 2600, 0, 1); }

  /* A pattern always leaves at least one survivable line through it. */
  function spawnPattern(z) {
    var d = difficulty();
    var lanes = shuffledLanes();
    var kind = Math.random();
    var used = 0;      // depth consumed by this pattern

    if (kind < 0.18) {
      // Single obstacle, coins over or beside it.
      var t = chance(0.55) ? 'crate' : (chance(0.5) ? 'gate' : 'wall');
      G.entities.push(makeObstacle(t, lanes[0], z));
      if (t === 'crate') coinArc(lanes[0], z - 3.4, 5, 1.0);
      else coinLine(lanes[1], z - 2, randInt(4, 6));
      used = OBSTACLES[t].len + 2;

    } else if (kind < 0.36) {
      // Two blocked lanes, one open — the open lane is paved with coins.
      var t1 = pick(['crate', 'wall', 'gate']);
      var t2 = pick(['crate', 'wall', 'gate']);
      G.entities.push(makeObstacle(t1, lanes[0], z));
      G.entities.push(makeObstacle(t2, lanes[1], z + rand(-0.6, 0.6)));
      coinLine(lanes[2], z - 2, randInt(5, 7));
      used = 3.5;

    } else if (kind < 0.5) {
      // Full row of one clearable type: every lane needs the same move.
      var full = chance(0.55) ? 'crate' : 'gate';
      for (var i = 0; i < 3; i++) G.entities.push(makeObstacle(full, i, z));
      if (full === 'crate') coinArc(randInt(0, 2), z - 3.4, 5, 1.2);
      else coinLine(randInt(0, 2), z + 2.5, 4);
      used = 3;

    } else if (kind < 0.66) {
      // A long cart: change lane, or land on its roof for the coin run.
      var cl = lanes[0];
      G.entities.push(makeObstacle('cart', cl, z + OBSTACLES.cart.len / 2));
      // A rising trail of coins leads into the jump, then runs along the roof.
      for (var a = 0; a < 4; a++) G.entities.push(makeCoin(cl, z - 6.4 + a * 1.6, 1.0 + a * 0.2));
      for (var c = 0; c < 5; c++) G.entities.push(makeCoin(cl, z + 1.2 + c * 1.6, OBSTACLES.cart.top + 0.8));
      if (d > 0.3 && chance(0.55)) G.entities.push(makeObstacle(pick(['crate', 'wall']), lanes[1], z + rand(2, 6)));
      used = OBSTACLES.cart.len + 3;

    } else if (kind < 0.8) {
      // Staircase: three offset obstacles that pull you across the lanes.
      var stepGap = lerp(9, 6.4, d);
      for (var s = 0; s < 3; s++) {
        var st = chance(0.6) ? 'crate' : pick(['gate', 'wall']);
        G.entities.push(makeObstacle(st, lanes[s], z + s * stepGap));
        if (chance(0.7)) coinLine(lanes[(s + 1) % 3], z + s * stepGap - 1.5, 3);
      }
      used = 2 * stepGap + 3;

    } else {
      // Breather: pure coins, sometimes a power-up.
      if (chance(0.5)) coinZigzag(z, randInt(7, 11));
      else coinLine(randInt(0, 2), z, randInt(6, 10));
      used = 8;
    }

    // Roadside throwers, once the run has some distance and score behind it.
    if (G.distance > CFG.enemyFrom && G.score > CFG.enemyScoreFrom && countEnemies() < 3 &&
        chance(0.38 + d * 0.34)) {
      G.entities.push(makeEnemy(z + used + rand(2, 8), chance(0.5) ? -1 : 1));
    }

    // Sprinkle power-ups on a clear lane.
    if (chance(0.16 + d * 0.05)) {
      var pz = z + used + rand(2, 5);
      var free = freeLaneNear(pz);
      G.entities.push(makePower(pick(['magnet', 'shield', 'double', 'dash']), free, pz));
    }
    return used;
  }

  function freeLaneNear(z) {
    var lanes = shuffledLanes();
    for (var i = 0; i < lanes.length; i++) {
      var clear = true;
      for (var j = 0; j < G.entities.length; j++) {
        var e = G.entities[j];
        if (e.kind !== 'obstacle' || e.lane !== lanes[i]) continue;
        if (Math.abs(e.z - z) < e.len / 2 + 3) { clear = false; break; }
      }
      if (clear) return lanes[i];
    }
    return lanes[0];
  }

  function updateSpawner() {
    var d = difficulty();
    while (G.spawnZ < CFG.drawDist) {
      var used = spawnPattern(G.spawnZ);
      // Reaction gap scales with speed so fast running never becomes unfair.
      var gap = G.speed * lerp(0.95, 0.62, d) + rand(1, 5);
      G.spawnZ += used + gap;
    }
    while (G.scenerySpawnZ < CFG.drawDist) {
      addScenery(G.scenerySpawnZ);
      G.scenerySpawnZ += rand(5.5, 11);
    }
  }

  function addScenery(z) {
    var side = chance(0.5) ? -1 : 1;
    var type = pick(['lantern', 'lantern', 'bamboo', 'bamboo', 'pagoda', 'rock']);
    G.scenery.push({
      type: type, side: side, z: z,
      x: side * rand(4.1, 7.4), h: type === 'pagoda' ? rand(3.4, 5.6) : rand(1.6, 3.4),
      seed: Math.random() * 6.28
    });
    if (chance(0.1)) G.scenery.push({ type: 'torii', side: 0, z: z + rand(1, 4), x: 0, h: 5.3, seed: 0 });
  }

  /* ───────────────────────── Effects ───────────────────────── */
  function puff(count, spread) {
    var s = scaleAt(CFG.playerZ);
    var px = projX(laneX(player.lanePos), CFG.playerZ, s);
    var py = projY(player.y, s);
    for (var i = 0; i < count; i++) {
      G.particles.push({
        x: px + rand(-14, 14), y: py - 2,
        vx: rand(-60, 60) * (spread || 1), vy: rand(-70, -15),
        life: rand(0.22, 0.42), max: 0.45, r: rand(2, 5), color: 'rgba(217,205,240,0.7)', g: 300
      });
    }
  }

  function sparkle(x, y, color, count) {
    for (var i = 0; i < (count || 8); i++) {
      var a = rand(0, 6.28), sp = rand(50, 210);
      G.particles.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: rand(0.25, 0.55), max: 0.55, r: rand(2, 5), color: color, g: 180
      });
    }
  }

  function floater(x, y, text, color) {
    G.floaters.push({ x: x, y: y, text: text, color: color || '#ffcf5c', life: 0.8 });
  }

  function toast(text) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    // restart the CSS animation
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.classList.add('hidden'); }, 1100);
  }

  /* ───────────────────────── Player physics ───────────────────────── */
  function playerHeight() { return player.rolling > 0 ? CFG.rollH : CFG.playerH; }

  function updatePlayer(dt) {
    // Lane tween
    if (player.laneT < 1) {
      player.laneT = Math.min(1, player.laneT + dt / CFG.laneTime);
      var t = player.laneT;
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      player.lanePos = lerp(player.laneFrom, player.lane, eased);
    } else {
      player.lanePos = player.lane;
      player.leanTarget = 0;
    }
    player.lean = lerp(player.lean, player.leanTarget, Math.min(1, dt * 12));

    // Which platform (cart roof) is under us right now?
    var ground = 0;
    player.platform = null;
    var px = laneX(player.lanePos);
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      if (e.kind !== 'obstacle' || !e.top || e.broken) continue;
      if (Math.abs(e.x - px) > (e.w / 2 + CFG.playerW / 2)) continue;
      var near = e.z - e.len / 2, far = e.z + e.len / 2;
      if (CFG.playerZ < near - 0.5 || CFG.playerZ > far + 0.5) continue;
      // Only counts as a floor if we are at or above its roof.
      if (player.y >= e.top - 0.06 && e.top > ground) { ground = e.top; player.platform = e; }
    }
    player.groundY = ground;

    // Vertical motion
    player.vy += CFG.gravity * dt;
    player.y += player.vy * dt;
    if (player.y <= player.groundY) {
      var wasAir = !player.onGround;
      player.y = player.groundY;
      player.vy = 0;
      if (wasAir) {
        player.onGround = true;
        Audio2.play('land');
        puff(5, 0.8);
        if (input.rollBuffer > 0) { input.rollBuffer = 0; doRoll(); }
      }
      player.onGround = true;
      player.coyote = CFG.coyote;
    } else {
      if (player.onGround) player.coyote = CFG.coyote;
      player.onGround = false;
      player.coyote = Math.max(0, (player.coyote || 0) - dt);
    }

    if (input.jumpBuffer > 0) {
      input.jumpBuffer -= dt;
      if (player.onGround) { input.jumpBuffer = 0; doJump(); }
    }
    if (input.rollBuffer > 0) input.rollBuffer -= dt;

    if (player.rolling > 0) {
      player.rolling -= dt;
      if (player.rolling <= 0 && chance(0.9)) puff(3, 0.4);
    }
    if (player.invuln > 0) player.invuln -= dt;

    // Run cycle speeds up with the world.
    if (player.onGround && player.rolling <= 0) player.runPhase += dt * (5.5 + G.speed * 0.34);
  }

  /* ───────────────────────── Power-ups ───────────────────────── */
  function grantPower(type) {
    var def = POWERS[type];
    G.powers[type] = def.time;
    Audio2.play('power');
    toast(def.icon + ' ' + def.label + '!');
    if (type === 'dash') G.flash = 0.35;
  }

  function updatePowers(dt) {
    for (var k in G.powers) {
      if (G.powers[k] > 0) {
        G.powers[k] = Math.max(0, G.powers[k] - dt);
      }
    }
  }

  function scoreMultiplier() { return G.powers.double > 0 ? 2 : 1; }

  /* ───────────────────────── Collisions ───────────────────────── */
  function hitObstacle(e) {
    if (G.powers.dash > 0) {                 // dash smashes straight through
      e.broken = 0.4;
      sparkle(projX(e.x, e.z, scaleAt(e.z)), projY(e.h / 2, scaleAt(e.z)), '#ffcf5c', 14);
      addScore(25, null);
      return;
    }
    if (player.invuln > 0) return;

    if (G.powers.shield > 0) {
      G.powers.shield = 0;
      player.invuln = CFG.invuln;
      e.broken = 0.4;
      Audio2.play('shieldbreak');
      toast('🛡️ Shield absorbed it');
      G.shake = 0.35;
      return;
    }

    damagePlayer(projX(e.x, e.z, scaleAt(e.z)), projY(1.1, scaleAt(e.z)));
  }

  function damagePlayer(sx, sy) {
    G.lives--;
    player.invuln = CFG.invuln;
    G.shake = 0.6;
    G.flash = 0.3;
    G.speed = Math.max(CFG.startSpeed, G.speed * 0.72);
    Audio2.play('hit');
    sparkle(sx, sy, '#ff6b8b', 16);
    renderLives();
    if (G.lives <= 0) endRun();
    else toast(G.lives === 1 ? 'Last life!' : G.lives + ' lives left');
  }

  function hitStar(e) {
    var s = scaleAt(e.z);
    var sx = projX(e.x, e.z, s), sy = projY(e.y, s);
    if (G.powers.dash > 0) {              // dash shatters it mid-air
      e.dodged = true;
      e.dead = true;
      sparkle(sx, sy, '#ffcf5c', 14);
      addScore(30 * scoreMultiplier(), { x: sx, y: sy });
      return;
    }
    if (player.invuln > 0) return;
    if (G.powers.shield > 0) {
      G.powers.shield = 0;
      player.invuln = CFG.invuln;
      e.dead = true;
      e.dodged = true;
      Audio2.play('shieldbreak');
      toast('🛡️ Shield absorbed it');
      G.shake = 0.35;
      return;
    }
    e.dead = true;
    e.dodged = true;
    damagePlayer(sx, sy);
  }

  function collidePlayer() {
    var pz0 = CFG.playerZ - 0.45, pz1 = CFG.playerZ + 0.45;
    var px = laneX(player.lanePos);
    var pyBottom = player.y, pyTop = player.y + playerHeight();
    var halfW = CFG.playerW / 2;
    var magnetOn = G.powers.magnet > 0;

    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];

      if (e.kind === 'coin' || e.kind === 'power') {
        if (e.taken) continue;
        if (magnetOn && e.kind === 'coin' && e.z > CFG.playerZ - 1 && e.z < CFG.playerZ + 16) {
          // Pull coins toward the ninja's lane and height.
          e.x = lerp(e.x, px, Math.min(1, 0.12 + (16 - (e.z - CFG.playerZ)) * 0.02));
          e.y = lerp(e.y, player.y + 0.9, 0.12);
        }
        // Swept z test so fast speeds never tunnel past a pickup.
        var zNear = Math.min(e.z, e.zPrev) - e.r, zFar = Math.max(e.z, e.zPrev) + e.r;
        if (zFar < pz0 || zNear > pz1) continue;
        if (Math.abs(e.x - px) > halfW + e.r + 0.15) continue;
        if (e.y + e.r < pyBottom - 0.15 || e.y - e.r > pyTop + 0.2) continue;

        e.taken = true;
        var s = scaleAt(e.z);
        if (e.kind === 'coin') {
          G.coins++;
          addScore(10 * scoreMultiplier(), null);
          Audio2.play('coin');
          sparkle(projX(e.x, e.z, s), projY(e.y, s), '#ffcf5c', 6);
          bumpHud('hudCoins');
        } else {
          grantPower(e.type);
          sparkle(projX(e.x, e.z, s), projY(e.y, s), POWERS[e.type].color, 16);
        }
        continue;
      }

      if (e.kind === 'star') {
        if (e.dead) continue;
        var szNear = Math.min(e.z, e.zPrev) - e.r, szFar = Math.max(e.z, e.zPrev) + e.r;
        if (szFar < pz0 || szNear > pz1) continue;
        if (Math.abs(e.x - px) > halfW + e.r) continue;
        if (e.y + e.r < pyBottom || e.y - e.r > pyTop) continue;
        hitStar(e);
        continue;
      }

      if (e.kind !== 'obstacle' || e.broken) continue;
      var near = e.z - e.len / 2, far = e.z + e.len / 2;
      if (far < pz0 || near > pz1) continue;
      if (Math.abs(e.x - px) > halfW + e.w / 2 - 0.12) continue;

      if (e.clear === 'roll') {
        // Overhead bar: only a rolling ninja fits underneath.
        if (pyTop > e.low + 0.02 && pyBottom < e.h) hitObstacle(e);
      } else if (e.top) {
        // Standable: safe once our feet are on or above the roof.
        if (pyBottom < e.top - 0.12) hitObstacle(e);
      } else {
        if (pyBottom < e.h - 0.1) hitObstacle(e);
      }
    }
  }

  /* ───────────────────────── World update ───────────────────────── */
  function addScore(amount, screenPos) {
    G.score += amount;
    if (screenPos) floater(screenPos.x, screenPos.y, '+' + amount);
  }

  function throwStar(e) {
    if (e.aimLane < 0) e.aimLane = player.lane;
    e.thrown = true;
    e.throwAnim = 0.35;
    var low = chance(0.4);
    var star = makeStar(e.x * 0.82, 1.35, e.z - 0.4, e.aimLane, low);
    G.entities.push(star);
    Audio2.play('throw');
  }

  function updateEnemies(dt) {
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      if (e.kind !== 'enemy') continue;
      if (e.throwAnim > 0) e.throwAnim -= dt;
      if (e.thrown || e.z > e.throwZ) continue;
      if (e.windup === 0) e.aimLane = player.lane;   // telegraphs the target lane
      e.windup += dt;
      if (e.windup >= CFG.throwWindup) throwStar(e);
    }
  }

  function updateStars(dt) {
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      if (e.kind !== 'star' || e.dead) continue;
      e.z -= CFG.starSpeed * dt;       // on top of the world scroll
      e.spin += dt * 18;
      var span = e.zStart - e.zEnd;
      var t = span > 0.1 ? clamp((e.zStart - e.z) / span, 0, 1) : 1;
      var ease = t * t * (3 - 2 * t);
      e.x = lerp(e.x0, e.targetX, ease);
      e.y = lerp(e.y0, e.targetY, ease);
      if (!e.dodged && e.z < CFG.playerZ - 0.7) {
        // Slipped past: pay for the dodge.
        e.dodged = true;
        var s = scaleAt(CFG.playerZ);
        addScore(15 * scoreMultiplier(), { x: projX(laneX(player.lanePos), CFG.playerZ, s), y: projY(1.9, s) });
        Audio2.play('lane');
      }
    }
  }

  function updateWorld(dt) {
    var boost = G.powers.dash > 0 ? CFG.dashBoost : 1;
    var speed = G.speed * boost;
    var move = speed * dt;

    G.distance += move;
    G.worldZ += move;
    G.speed = Math.min(CFG.maxSpeed, G.speed + CFG.accel * dt);

    var i, e;
    for (i = G.entities.length - 1; i >= 0; i--) {
      e = G.entities[i];
      e.zPrev = e.z;
      e.z -= move;
      if (e.spin != null) e.spin += dt * 3.2;
      if (e.broken) { e.broken -= dt; if (e.broken <= 0) { G.entities.splice(i, 1); continue; } }
      if (e.dead || e.z < 1.2) G.entities.splice(i, 1);
    }
    for (i = G.scenery.length - 1; i >= 0; i--) {
      G.scenery[i].z -= move;
      if (G.scenery[i].z < 1) G.scenery.splice(i, 1);
    }

    updateEnemies(dt);
    updateStars(dt);

    G.spawnZ -= move;
    G.scenerySpawnZ -= move;
    updateSpawner();

    // Biome crossfade every 900 m.
    var biomePos = G.distance / 900;
    var idx = Math.floor(biomePos) % BIOMES.length;
    if (idx !== G.biome && G.biomeMix >= 1) { G.biomePrev = G.biome; G.biome = idx; G.biomeMix = 0; toast(BIOMES[idx].name); }
    G.biomeMix = Math.min(1, G.biomeMix + dt / 2.5);

    // Distance points, doubled while the ✨ power-up is live.
    addScore(move * 0.9 * scoreMultiplier(), null);

    var rival = Store.data.rival;
    if (rival && !G.rivalBeaten && G.score > rival.score) {
      G.rivalBeaten = true;
      Audio2.play('power');
      toast('🏆 Passed ' + rival.name + '!');
      G.flash = 0.2;
      var rs = scaleAt(CFG.playerZ);
      sparkle(projX(laneX(player.lanePos), CFG.playerZ, rs), projY(player.y + 1, rs), '#6ef7c1', 18);
      renderRival();
    }

    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 1.6);
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 2.2);
  }

  function updateParticles(dt) {
    var i, p;
    for (i = G.particles.length - 1; i >= 0; i--) {
      p = G.particles[i];
      p.life -= dt;
      if (p.life <= 0) { G.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
    }
    for (i = G.floaters.length - 1; i >= 0; i--) {
      var f = G.floaters[i];
      f.life -= dt;
      f.y -= dt * 60;
      if (f.life <= 0) G.floaters.splice(i, 1);
    }
  }

  function step(dt) {
    G.time += dt;
    updateWorld(dt);
    updatePlayer(dt);
    updatePowers(dt);
    collidePlayer();
    updateParticles(dt);
  }

  /* ───────────────────────── Rendering ───────────────────────── */
  var ROAD_HALF = CFG.laneW * 1.5 + 0.31;

  // Radial gradients are expensive to build every frame, so each colour's glow
  // is rendered once into an offscreen canvas and then just blitted.
  var glowCache = {};
  function glowSprite(color) {
    var sprite = glowCache[color];
    if (sprite) return sprite;
    var size = 128;
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    var g = sprite.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    grd.addColorStop(0, rgba(color, 0.9));
    grd.addColorStop(0.3, rgba(color, 0.42));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    glowCache[color] = sprite;
    return sprite;
  }

  function drawGlow(x, y, radius, color, alpha) {
    if (radius <= 0.5) return;
    var prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * clamp(alpha, 0, 1);
    ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = prev;
  }

  // One colour per required move, used on the road glow, the rim light and the
  // glyph, so an obstacle can be read long before its shape is legible.
  var ACTION_COLOR = { jump: '#ffcf5c', roll: '#ff6b8b', lane: '#7eb8ff' };

  // Readability layers, individually switchable for profiling.
  var FX = { glow: true, rim: true, glyph: true, beacon: true };
  var pal = {};

  function updatePalette() {
    var a = BIOMES[G.biomePrev], b = BIOMES[G.biome], t = G.biomeMix;
    pal.sky0 = mixHex(a.sky[0], b.sky[0], t);
    pal.sky1 = mixHex(a.sky[1], b.sky[1], t);
    pal.sky2 = mixHex(a.sky[2], b.sky[2], t);
    pal.road = mixHex(a.road, b.road, t);
    pal.roadAlt = mixHex(a.roadAlt, b.roadAlt, t);
    pal.railHex = t < 0.5 ? a.rail : b.rail;
    pal.fogHex = t < 0.5 ? a.fog : b.fog;
    pal.hill = mixHex(a.hill, b.hill, t);
    pal.prop = mixHex(a.prop, b.prop, t);
    pal.glowHex = t < 0.5 ? a.glow : b.glow;
    pal.name = t < 0.5 ? a.name : b.name;
  }

  var stars = [];
  function initStars() {
    stars.length = 0;
    for (var i = 0; i < 70; i++) {
      stars.push({ x: Math.random(), y: Math.random() * 0.34, r: rand(0.5, 1.7), tw: Math.random() * 6.28 });
    }
  }
  initStars();

  function drawSky() {
    var h = view.horizon;
    var g = ctx.createLinearGradient(0, 0, 0, h + 4);
    g.addColorStop(0, pal.sky0);
    g.addColorStop(0.62, pal.sky1);
    g.addColorStop(1, pal.sky2);
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, view.w + 80, h + 44);

    // Stars
    ctx.save();
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.45 + 0.55 * Math.abs(Math.sin(G.time * 1.4 + s.tw));
      ctx.globalAlpha = tw * 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x * view.w, s.y * view.h, s.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();

    // Moon
    var mx = view.w * 0.76, my = view.h * 0.12, mr = Math.min(view.w, view.h) * 0.075;
    var mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.15, mx, my, mr * 2.6);
    mg.addColorStop(0, rgba(pal.glowHex, 0.95));
    mg.addColorStop(0.28, rgba(pal.glowHex, 0.42));
    mg.addColorStop(1, rgba(pal.glowHex, 0));
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(mx, my, mr * 2.6, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = '#fff7de';
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, 6.2832);
    ctx.fill();

    // Parallax hills
    var off = (G.worldZ * 0.9) % (view.w * 2);
    ctx.fillStyle = pal.hill;
    for (var layer = 0; layer < 2; layer++) {
      var amp = view.h * (layer === 0 ? 0.11 : 0.075);
      var base = view.horizon + (layer === 0 ? 2 : 1);
      var shift = -off * (layer === 0 ? 0.12 : 0.22);
      ctx.globalAlpha = layer === 0 ? 0.85 : 0.6;
      ctx.beginPath();
      ctx.moveTo(-60, base);
      for (var x = -60; x <= view.w + 60; x += 22) {
        var n = Math.sin((x + shift) * 0.011 + layer * 2.1) + 0.5 * Math.sin((x + shift) * 0.027 + layer);
        ctx.lineTo(x, base - amp * (0.55 + 0.45 * n));
      }
      ctx.lineTo(view.w + 60, base + 8);
      ctx.lineTo(-60, base + 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRoad() {
    var h = view.h, hz = view.horizon;
    // Ground plane beneath everything
    ctx.fillStyle = pal.road;
    ctx.fillRect(0, hz, view.w, h - hz);

    var step = 10;
    var y = hz + 1;
    while (y < h + step) {
      var y2 = Math.min(h + step, y + step);
      var z1 = CFG.camY * view.focal / (y - hz);
      var z2 = CFG.camY * view.focal / Math.max(0.6, y2 - hz);
      if (z1 > CFG.drawDist + 20) { y = y2; continue; }
      var s1 = scaleAt(z1), s2 = scaleAt(z2);
      var half1 = ROAD_HALF * s1, half2 = ROAD_HALF * s2;
      var stripe = Math.floor((G.worldZ + (z1 + z2) / 2) / 3.2) % 2 === 0;
      ctx.fillStyle = stripe ? pal.road : pal.roadAlt;
      ctx.beginPath();
      ctx.moveTo(view.cx - half1, y);
      ctx.lineTo(view.cx + half1, y);
      ctx.lineTo(view.cx + half2, y2);
      ctx.lineTo(view.cx - half2, y2);
      ctx.closePath();
      ctx.fill();

      // Dashed lane dividers
      var dash = Math.floor((G.worldZ + (z1 + z2) / 2) / 2.1) % 2 === 0;
      if (dash) {
        ctx.fillStyle = rgba('#ffffff', 0.18);
        for (var d = -1; d <= 1; d += 2) {
          var dx1 = (d * CFG.laneW / 2) * s1, dx2 = (d * CFG.laneW / 2) * s2;
          var wgt1 = 0.05 * s1, wgt2 = 0.05 * s2;
          ctx.beginPath();
          ctx.moveTo(view.cx + dx1 - wgt1, y);
          ctx.lineTo(view.cx + dx1 + wgt1, y);
          ctx.lineTo(view.cx + dx2 + wgt2, y2);
          ctx.lineTo(view.cx + dx2 - wgt2, y2);
          ctx.closePath();
          ctx.fill();
        }
      }
      y = y2;
    }

    // Glowing rails along both edges
    ctx.strokeStyle = rgba(pal.railHex, 0.55);
    ctx.lineWidth = 2;
    ctx.shadowBlur = 12;
    ctx.shadowColor = rgba(pal.railHex, 0.6);
    for (var side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      var sFar = scaleAt(CFG.drawDist), sNear = scaleAt(1.2);
      ctx.moveTo(view.cx + side * ROAD_HALF * sFar, projY(0, sFar));
      ctx.lineTo(view.cx + side * ROAD_HALF * sNear, projY(0, sNear));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Distance fog so pop-in stays invisible
    var fg = ctx.createLinearGradient(0, hz - 6, 0, hz + view.h * 0.2);
    fg.addColorStop(0, rgba(pal.fogHex, 0.7));
    fg.addColorStop(1, rgba(pal.fogHex, 0));
    ctx.fillStyle = fg;
    ctx.fillRect(0, hz - 6, view.w, view.h * 0.24);
  }

  /* Draw an axis-aligned world box in perspective (front, top and one side). */
  function box3d(cxWorld, yBottom, yTop, halfW, zNear, zFar, cFront, cTop, cSide) {
    if (zNear < 0.6) zNear = 0.6;
    if (zFar <= zNear) zFar = zNear + 0.05;
    var sN = scaleAt(zNear), sF = scaleAt(zFar);
    var nl = projX(cxWorld - halfW, zNear, sN), nr = projX(cxWorld + halfW, zNear, sN);
    var fl = projX(cxWorld - halfW, zFar, sF), fr = projX(cxWorld + halfW, zFar, sF);
    var nb = projY(yBottom, sN), nt = projY(yTop, sN);
    var fb = projY(yBottom, sF), ft = projY(yTop, sF);

    // Side face (we see the side the box is offset from centre)
    ctx.fillStyle = cSide;
    if (cxWorld < -0.01) {
      ctx.beginPath(); ctx.moveTo(nr, nt); ctx.lineTo(fr, ft); ctx.lineTo(fr, fb); ctx.lineTo(nr, nb);
      ctx.closePath(); ctx.fill();
    } else if (cxWorld > 0.01) {
      ctx.beginPath(); ctx.moveTo(nl, nt); ctx.lineTo(fl, ft); ctx.lineTo(fl, fb); ctx.lineTo(nl, nb);
      ctx.closePath(); ctx.fill();
    }
    // Top face
    ctx.fillStyle = cTop;
    ctx.beginPath(); ctx.moveTo(nl, nt); ctx.lineTo(nr, nt); ctx.lineTo(fr, ft); ctx.lineTo(fl, ft);
    ctx.closePath(); ctx.fill();
    // Front face
    ctx.fillStyle = cFront;
    ctx.fillRect(nl, nt, nr - nl, nb - nt);
    return { nl: nl, nr: nr, nt: nt, nb: nb, sN: sN };
  }

  /* A glow painted on the road in front of an obstacle. It stays wide and
     bright at any distance, so the lane and the hazard read from far away. */
  function groundGlow(x, halfW, zNear, zFar, color, alpha) {
    if (zFar < 1.4) return;
    var zn = Math.max(zNear, 1.4);
    if (zFar - zn < 0.05) return;
    var bands = 3;
    for (var i = 0; i < bands; i++) {
      var z0 = zn + (zFar - zn) * (i / bands);
      var z1 = zn + (zFar - zn) * ((i + 1) / bands);
      var s0 = scaleAt(z0), s1 = scaleAt(z1);
      var y0 = projY(0.015, s0), y1 = projY(0.015, s1);
      if (y0 - y1 < 0.4) continue;
      ctx.fillStyle = rgba(color, alpha * (0.3 + 0.7 * ((i + 1) / bands)));
      ctx.beginPath();
      ctx.moveTo(projX(x - halfW, z0, s0), y0);
      ctx.lineTo(projX(x + halfW, z0, s0), y0);
      ctx.lineTo(projX(x + halfW, z1, s1), y1);
      ctx.lineTo(projX(x - halfW, z1, s1), y1);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* The move itself, drawn on the face you are running at. */
  function actionGlyph(cx, cy, size, action, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(12,7,22,0.55)';
    ctx.lineWidth = Math.max(3, size * 0.4);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var path = function () {
      ctx.beginPath();
      if (action === 'jump') {
        ctx.moveTo(-size, size * 0.45); ctx.lineTo(0, -size * 0.5); ctx.lineTo(size, size * 0.45);
        ctx.moveTo(-size, size * 1.05); ctx.lineTo(0, size * 0.1); ctx.lineTo(size, size * 1.05);
      } else if (action === 'roll') {
        ctx.moveTo(-size, -size * 0.45); ctx.lineTo(0, size * 0.5); ctx.lineTo(size, -size * 0.45);
        ctx.moveTo(-size, -size * 1.05); ctx.lineTo(0, -size * 0.1); ctx.lineTo(size, -size * 1.05);
      } else {
        ctx.moveTo(-size * 0.35, -size * 0.6); ctx.lineTo(-size * 1.1, 0); ctx.lineTo(-size * 0.35, size * 0.6);
        ctx.moveTo(size * 0.35, -size * 0.6); ctx.lineTo(size * 1.1, 0); ctx.lineTo(size * 0.35, size * 0.6);
      }
    };
    path();
    ctx.stroke();                       // dark backing so it reads on any face
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.6, size * 0.22);
    path();
    ctx.stroke();
    ctx.restore();
  }

  /* A bright lip along the top and near edges of a box. */
  function rimLight(b, color, strength) {
    var w = Math.max(1.2, 0.05 * b.sN);
    ctx.save();
    ctx.strokeStyle = rgba(color, 0.55 * (strength || 1));
    ctx.lineWidth = w;
    ctx.strokeRect(b.nl, b.nt, b.nr - b.nl, b.nb - b.nt);
    ctx.strokeStyle = rgba(color, 0.95 * (strength || 1));
    ctx.lineWidth = w * 1.7;
    ctx.beginPath();
    ctx.moveTo(b.nl, b.nt);
    ctx.lineTo(b.nr, b.nt);
    ctx.stroke();
    ctx.restore();
  }

  function drawObstacle(e) {
    var zN = e.z - e.len / 2, zF = e.z + e.len / 2;
    if (zF < 1.2 || zN > CFG.drawDist + 12) return;
    var alpha = e.broken ? clamp(e.broken / 0.4, 0, 1) : 1;
    var col = ACTION_COLOR[e.clear] || '#ffffff';
    ctx.save();
    ctx.globalAlpha = alpha;
    var s = scaleAt(Math.max(zN, 0.7));

    // Road glow leading into the obstacle, and a brighter patch under it.
    if (FX.glow) {
      groundGlow(e.x, e.w * 0.52, zN - 3.4, zN, col, 0.6);
      groundGlow(e.x, e.w * 0.52, zN, zF, col, 0.4);
    }


    // Contact shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(projX(e.x, e.z, s), projY(0, s), e.w * 0.62 * s, 0.18 * s, 0, 0, 6.2832);
    ctx.fill();

    var b, faceW, faceH, glyph;

    if (e.type === 'crate') {
      b = box3d(e.x, 0, e.h, e.w / 2, zN, zF, '#8a5f37', '#b8834e', '#5c3d21');
      // Rope bindings
      ctx.strokeStyle = 'rgba(255,224,138,0.8)';
      ctx.lineWidth = Math.max(1, 0.05 * b.sN);
      ctx.beginPath();
      ctx.moveTo(b.nl, b.nt + (b.nb - b.nt) * 0.5); ctx.lineTo(b.nr, b.nt + (b.nb - b.nt) * 0.5);
      ctx.stroke();
      if (FX.rim) rimLight(b, col, 1);
      faceW = b.nr - b.nl; faceH = b.nb - b.nt;
      glyph = Math.min(faceW, faceH) * 0.26;
      if (FX.glyph && glyph > 2.2) actionGlyph((b.nl + b.nr) / 2, b.nt + faceH * 0.52, glyph, 'jump', col);

    } else if (e.type === 'gate') {
      // Two posts plus a low crossbar you have to roll under.
      var postW = 0.16;
      box3d(e.x - e.w / 2 + postW, 0, e.h, postW, zN, zF, '#a3384f', '#c34c66', '#75253a');
      box3d(e.x + e.w / 2 - postW, 0, e.h, postW, zN, zF, '#a3384f', '#c34c66', '#75253a');
      b = box3d(e.x, e.low, e.h - 0.15, e.w / 2, zN, zF, '#d9573f', '#ff8a63', '#a03b2b');
      if (FX.rim) rimLight(b, col, 1);
      // Glow under the bar so the gap you roll through reads at distance.
      var sm = scaleAt(Math.max(zN, 0.7));
      var gx = projX(e.x, zN, sm), gy = projY((e.low + e.h) / 2, sm);
      drawGlow(gx, gy, 1.4 * sm, '#ff6b8b', 0.5);
      faceW = b.nr - b.nl; faceH = b.nb - b.nt;
      glyph = Math.min(faceW * 0.5, faceH) * 0.42;
      if (FX.glyph && glyph > 2.2) actionGlyph((b.nl + b.nr) / 2, b.nt + faceH * 0.5, glyph, 'roll', col);

    } else if (e.type === 'wall') {
      b = box3d(e.x, 0, e.h, e.w / 2, zN, zF, '#356a4d', '#4a9670', '#244a36');
      // Bamboo slats
      ctx.strokeStyle = 'rgba(180,240,190,0.4)';
      ctx.lineWidth = Math.max(1, 0.04 * b.sN);
      var slats = 5;
      for (var i = 1; i < slats; i++) {
        var xx = b.nl + (b.nr - b.nl) * (i / slats);
        ctx.beginPath(); ctx.moveTo(xx, b.nt); ctx.lineTo(xx, b.nb); ctx.stroke();
      }
      if (FX.rim) rimLight(b, col, 1);
      faceW = b.nr - b.nl; faceH = b.nb - b.nt;
      glyph = Math.min(faceW, faceH) * 0.22;
      if (FX.glyph && glyph > 2.2) actionGlyph((b.nl + b.nr) / 2, b.nt + faceH * 0.42, glyph, 'lane', col);

    } else if (e.type === 'cart') {
      b = box3d(e.x, 0.34, e.top, e.w / 2, zN, zF, '#4b3878', '#6b53a6', '#332652');
      // Roof trim and side banner
      box3d(e.x, e.top, e.top + 0.12, e.w / 2 + 0.06, zN, zF, '#ffcf5c', '#ffe08a', '#c79a34');
      ctx.fillStyle = 'rgba(255,107,139,0.7)';
      ctx.fillRect(b.nl, b.nt + (b.nb - b.nt) * 0.35, b.nr - b.nl, (b.nb - b.nt) * 0.16);
      // Wheels
      var sw = scaleAt(Math.max(zN, 0.7));
      ctx.fillStyle = '#171024';
      for (var wsign = -1; wsign <= 1; wsign += 2) {
        var wx = projX(e.x + wsign * (e.w / 2 - 0.12), zN, sw);
        ctx.beginPath();
        ctx.arc(wx, projY(0.3, sw), 0.3 * sw, 0, 6.2832);
        ctx.fill();
      }
      if (FX.rim) rimLight(b, col, 1);
      faceW = b.nr - b.nl; faceH = b.nb - b.nt;
      glyph = Math.min(faceW, faceH) * 0.24;
      if (FX.glyph && glyph > 2.2) actionGlyph((b.nl + b.nr) / 2, b.nt + faceH * 0.55, glyph, 'lane', col);
    }

    // Far off, the shape is only a few pixels tall. Stand a fixed-size beacon
    // on it so the lane and the move still read against the horizon.
    var onScreenH = e.h * s;
    if (FX.beacon && onScreenH < 24) {
      var bx = projX(e.x, zN, s), by = projY(0, s);
      ctx.save();
      ctx.globalAlpha = alpha * clamp((24 - onScreenH) / 8, 0, 0.85);
      drawGlow(bx, by - 9, 16, col, 0.5);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - 15);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(bx, by - 18, 3, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCoin(e) {
    if (e.taken) return;
    var s = scaleAt(e.z);
    if (e.z < 1.2) return;
    var x = projX(e.x, e.z, s), y = projY(e.y, s);
    var r = e.r * s;
    var wobble = Math.abs(Math.cos(e.spin));
    ctx.save();
    drawGlow(x, y, r * 2.4, '#ffcf5c', 0.55);

    var cg = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    cg.addColorStop(0, '#fff2c0');
    cg.addColorStop(0.5, '#ffcf5c');
    cg.addColorStop(1, '#d9902b');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(1, r * wobble), r, 0, 0, 6.2832);
    ctx.fill();
    if (wobble > 0.35) {
      ctx.strokeStyle = 'rgba(120,70,10,0.5)';
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(1, r * wobble * 0.55), r * 0.58, 0, 0, 6.2832);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPower(e) {
    if (e.taken) return;
    var s = scaleAt(e.z);
    if (e.z < 1.2) return;
    var def = POWERS[e.type];
    var x = projX(e.x, e.z, s), y = projY(e.y + Math.sin(G.time * 3 + e.spin) * 0.12, s);
    var r = e.r * s;
    ctx.save();
    drawGlow(x, y, r * 2.2, def.color, 0.6);

    ctx.translate(x, y);
    ctx.rotate(Math.sin(e.spin * 0.5) * 0.3);
    ctx.fillStyle = 'rgba(12,7,22,0.82)';
    ctx.strokeStyle = def.color;
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    roundRect(-r, -r, r * 2, r * 2, r * 0.42);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = def.color;
    ctx.strokeStyle = def.color;
    ctx.lineWidth = Math.max(1.4, r * 0.16);
    var u = r * 0.55;
    if (e.type === 'magnet') {
      ctx.beginPath();
      ctx.arc(0, u * 0.25, u, Math.PI, 0);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.4, r * 0.2);
      ctx.beginPath();
      ctx.moveTo(-u, u * 0.25); ctx.lineTo(-u, u);
      ctx.moveTo(u, u * 0.25); ctx.lineTo(u, u);
      ctx.stroke();
    } else if (e.type === 'shield') {
      ctx.beginPath();
      ctx.moveTo(0, -u * 1.1);
      ctx.lineTo(u, -u * 0.5);
      ctx.lineTo(u * 0.75, u);
      ctx.lineTo(0, u * 1.2);
      ctx.lineTo(-u * 0.75, u);
      ctx.lineTo(-u, -u * 0.5);
      ctx.closePath();
      ctx.stroke();
    } else if (e.type === 'double') {
      star(0, 0, u * 1.15, u * 0.5, 5);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(u * 0.35, -u * 1.15);
      ctx.lineTo(-u * 0.7, u * 0.15);
      ctx.lineTo(-u * 0.05, u * 0.15);
      ctx.lineTo(-u * 0.35, u * 1.15);
      ctx.lineTo(u * 0.75, -u * 0.15);
      ctx.lineTo(u * 0.1, -u * 0.15);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* A rival ninja on a roadside plinth: idles, winds up, then throws. */
  function drawEnemy(e) {
    if (e.z < 1.3 || e.z > CFG.drawDist + 12) return;
    var s = scaleAt(e.z);
    var plinth = 0.45;

    box3d(e.x, 0, plinth, 0.52, e.z - 0.5, e.z + 0.5, '#241a3c', '#35275a', '#180f2b');

    var aiming = !e.thrown && e.windup > 0;
    var charge = aiming ? clamp(e.windup / CFG.throwWindup, 0, 1) : 0;

    // Menacing glow while winding up.
    if (aiming) {
      var gx = projX(e.x, e.z, s), gy = projY(plinth + 1.1, s);
      drawGlow(gx, gy, 1.8 * s, '#ff6b8b', 0.35 + charge * 0.35);
    }

    ctx.save();
    ctx.translate(projX(e.x, e.z, s), projY(plinth, s));
    ctx.scale(s, -s);

    var suit = '#4a1f36', suitDark = '#2b1122', band = '#ff6b8b', steel = '#d9d3ea';
    var idle = Math.sin(G.time * 2.4 + e.seed) * 0.02;
    var hipY = 0.58 + idle, shoulderY = 0.98 + idle, headY = 1.24 + idle;

    // Legs planted in a wide stance
    limb(-0.08, hipY, -0.14, hipY - 0.3, -0.17, 0.02, 0.13, suitDark);
    limb(0.08, hipY, 0.14, hipY - 0.3, 0.17, 0.02, 0.13, suitDark);

    // Torso
    ctx.fillStyle = suit;
    ctx.beginPath();
    ctx.moveTo(-0.17, hipY - 0.02);
    ctx.quadraticCurveTo(-0.22, shoulderY - 0.12, -0.18, shoulderY);
    ctx.quadraticCurveTo(0, shoulderY + 0.08, 0.18, shoulderY);
    ctx.quadraticCurveTo(0.22, shoulderY - 0.12, 0.17, hipY - 0.02);
    ctx.quadraticCurveTo(0, hipY - 0.09, -0.17, hipY - 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = band;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(-0.17, hipY + 0.04);
    ctx.quadraticCurveTo(0, hipY + 0.09, 0.17, hipY + 0.04);
    ctx.stroke();

    // Throwing arm: cocked back, then snapped forward
    var throwT = e.throwAnim > 0 ? clamp(e.throwAnim / 0.35, 0, 1) : 0;
    var armSide = e.side < 0 ? 1 : -1;   // throws with the arm facing the road
    var cock = charge * 0.9;
    var handX = armSide * (0.24 + cock * 0.12) * (throwT > 0 ? -0.4 : 1);
    var handY = shoulderY + cock * 0.3 - (throwT > 0 ? 0.28 : 0);
    limb(armSide * 0.16, shoulderY - 0.02, armSide * 0.3, shoulderY + cock * 0.14, handX, handY, 0.1, suit);
    limb(-armSide * 0.16, shoulderY - 0.02, -armSide * 0.28, shoulderY - 0.16, -armSide * 0.24, shoulderY - 0.3, 0.1, suit);

    // A star held ready in the cocked hand
    if (aiming) {
      ctx.save();
      ctx.translate(handX, handY + 0.1);
      ctx.rotate(G.time * 6);
      ctx.fillStyle = steel;
      star(0, 0, 0.13, 0.05, 4);
      ctx.fill();
      ctx.restore();
    }

    // Head, mask slit and headband
    ctx.fillStyle = suitDark;
    ctx.beginPath(); ctx.arc(0, headY, 0.22, 0, 6.2832); ctx.fill();
    ctx.fillStyle = aiming ? '#ffd9df' : '#e7b9c4';
    ctx.beginPath();
    ctx.ellipse(0, headY - 0.01, 0.15, 0.048, 0, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = '#c0203c';
    ctx.beginPath(); ctx.ellipse(-0.07, headY - 0.01, 0.032, 0.03, 0, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.07, headY - 0.01, 0.032, 0.03, 0, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = band;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(-0.2, headY + 0.08);
    ctx.quadraticCurveTo(0, headY + 0.13, 0.2, headY + 0.08);
    ctx.stroke();
    drawRibbon(e.side < 0 ? -0.18 : 0.18, headY + 0.06, e.side < 0 ? -1 : 1, G.time + e.seed, 0.07, 0.26, band);

    ctx.restore();
  }

  function drawStar(e) {
    if (e.dead || e.z < 1.1) return;
    var s = scaleAt(e.z);
    var x = projX(e.x, e.z, s), y = projY(e.y, s);
    var r = e.r * s;

    // Trail back toward where it came from
    var ts = scaleAt(Math.min(CFG.drawDist, e.z + 3));
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#ff6b8b';
    ctx.lineWidth = Math.max(1, r * 0.5);
    ctx.beginPath();
    ctx.moveTo(projX(lerp(e.x, e.x0, 0.12), e.z + 3, ts), projY(lerp(e.y, e.y0, 0.12), ts));
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();

    drawGlow(x, y, r * 2.6, '#ff6b8b', 0.6);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(e.spin);
    var sg = ctx.createLinearGradient(-r, -r, r, r);
    sg.addColorStop(0, '#ffffff');
    sg.addColorStop(0.5, '#cfc8e6');
    sg.addColorStop(1, '#8d86a8');
    ctx.fillStyle = sg;
    star(0, 0, r, r * 0.34, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,12,34,0.8)';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(20,12,34,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  /* Chevrons on the road warn which lane is being aimed at. */
  function drawAimWarnings() {
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      if (e.kind !== 'enemy' || e.thrown || e.windup <= 0 || e.aimLane < 0) continue;
      var charge = clamp(e.windup / CFG.throwWindup, 0, 1);
      var z = CFG.playerZ + 10;
      var s = scaleAt(z);
      var cx = projX(laneX(e.aimLane), z, s), cy = projY(0.02, s);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(G.time * 12));
      ctx.fillStyle = '#ff6b8b';
      for (var k = 0; k < 2; k++) {
        var oy = cy - k * 0.55 * s;
        ctx.beginPath();
        ctx.moveTo(cx, oy + 0.42 * s * (0.6 + charge * 0.4));
        ctx.lineTo(cx - 0.46 * s, oy - 0.08 * s);
        ctx.lineTo(cx - 0.27 * s, oy - 0.08 * s);
        ctx.lineTo(cx, oy + 0.22 * s);
        ctx.lineTo(cx + 0.27 * s, oy - 0.08 * s);
        ctx.lineTo(cx + 0.46 * s, oy - 0.08 * s);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function star(cx, cy, outer, inner, points) {
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var rr = i % 2 === 0 ? outer : inner;
      var a = (i * Math.PI) / points - Math.PI / 2;
      var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawScenery(o) {
    if (o.z < 1.6) return;
    var s = scaleAt(o.z);
    var nearFade = clamp((o.z - 1.6) / 4.5, 0, 1);
    var x = projX(o.x, o.z, s), base = projY(0, s);
    var sway = Math.sin(G.time * 1.3 + o.seed) * 0.03;

    if (o.type === 'torii') {
      // Ceremonial arch spanning the whole road, well above the ninja.
      ctx.save();
      ctx.globalAlpha = nearFade;
      var zN = o.z - 0.3, zF = o.z + 0.3;
      box3d(-ROAD_HALF - 0.3, 0, o.h, 0.18, zN, zF, '#b2352f', '#d2564a', '#8a231f');
      box3d(ROAD_HALF + 0.3, 0, o.h, 0.18, zN, zF, '#b2352f', '#d2564a', '#8a231f');
      box3d(0, o.h - 0.55, o.h - 0.2, ROAD_HALF + 0.75, zN, zF, '#b2352f', '#d2564a', '#8a231f');
      box3d(0, o.h, o.h + 0.16, ROAD_HALF + 0.95, zN, zF, '#7d2420', '#9c3a33', '#5e1a17');
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = nearFade;
    if (o.type === 'lantern') {
      ctx.fillStyle = pal.prop;
      ctx.fillRect(x - 0.06 * s, base - o.h * s, 0.12 * s, o.h * s);
      var ly = base - o.h * s;
      var lr = 0.32 * s;
      var g = ctx.createRadialGradient(x, ly, lr * 0.2, x, ly, lr * 4);
      g.addColorStop(0, rgba(pal.glowHex, 0.5));
      g.addColorStop(1, rgba(pal.glowHex, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, ly, lr * 4, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#ff9a5c';
      ctx.beginPath();
      ctx.ellipse(x, ly, lr * 0.75, lr, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x - lr * 0.75, ly - lr * 0.1, lr * 1.5, lr * 0.16);
    } else if (o.type === 'bamboo') {
      for (var i = 0; i < 4; i++) {
        var bx = x + (i - 1.5) * 0.22 * s;
        var bh = o.h * s * (0.75 + ((i * 37) % 11) / 22);
        var tipX = bx + sway * s * 4;
        ctx.strokeStyle = pal.prop;
        ctx.lineWidth = Math.max(1, 0.07 * s);
        ctx.beginPath();
        ctx.moveTo(bx, base);
        ctx.quadraticCurveTo(bx + sway * s * 1.5, base - bh * 0.6, tipX, base - bh);
        ctx.stroke();
        // Segment nodes
        ctx.strokeStyle = rgba('#000000', 0.25);
        ctx.lineWidth = Math.max(1, 0.05 * s);
        for (var n = 1; n < 4; n++) {
          var ny = base - bh * (n / 4);
          ctx.beginPath();
          ctx.moveTo(bx - 0.05 * s, ny);
          ctx.lineTo(bx + 0.05 * s, ny);
          ctx.stroke();
        }
        // Leaves near the tip
        ctx.fillStyle = rgba(pal.railHex, 0.3);
        for (var lf = 0; lf < 2; lf++) {
          var ly2 = base - bh * (0.72 + lf * 0.16);
          var dirL = lf % 2 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(tipX, ly2);
          ctx.quadraticCurveTo(tipX + dirL * 0.4 * s, ly2 - 0.12 * s, tipX + dirL * 0.62 * s, ly2 + 0.04 * s);
          ctx.quadraticCurveTo(tipX + dirL * 0.35 * s, ly2 + 0.1 * s, tipX, ly2);
          ctx.fill();
        }
      }
    } else if (o.type === 'pagoda') {
      var tiers = 3, tw = 1.5 * s, th = (o.h * s) / tiers;
      ctx.fillStyle = pal.prop;
      ctx.fillRect(x - tw * 0.18, base - o.h * s, tw * 0.36, o.h * s);
      for (var t = 0; t < tiers; t++) {
        var ty = base - th * (t + 1);
        var wd = tw * (1 - t * 0.2);
        ctx.fillStyle = t % 2 ? '#1c1430' : pal.prop;
        ctx.beginPath();
        ctx.moveTo(x - wd / 2, ty + th * 0.28);
        ctx.quadraticCurveTo(x, ty - th * 0.16, x + wd / 2, ty + th * 0.28);
        ctx.lineTo(x + wd * 0.3, ty + th * 0.34);
        ctx.lineTo(x - wd * 0.3, ty + th * 0.34);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = rgba(pal.glowHex, 0.5);
      ctx.fillRect(x - 0.1 * s, base - o.h * s * 0.55, 0.2 * s, 0.2 * s);
    } else {
      ctx.fillStyle = pal.prop;
      ctx.beginPath();
      ctx.moveTo(x - 0.7 * s, base);
      ctx.quadraticCurveTo(x - 0.4 * s, base - o.h * s * 0.8, x, base - o.h * s * 0.55);
      ctx.quadraticCurveTo(x + 0.5 * s, base - o.h * s * 0.75, x + 0.75 * s, base);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /* ───────────────────────── The ninja ───────────────────────── */
  function limb(x1, y1, x2, y2, x3, y3, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
  }

  // A tapered strip of cloth streaming away from the runner, drawn behind the body.
  function drawRibbon(ax, ay, dir, phase, width, len, color) {
    var pts = [];
    for (var i = 0; i <= 5; i++) {
      var t = i / 5;
      var wob = Math.sin(phase * 8 - i * 1.1) * 0.05 * t;
      pts.push([ax + dir * len * 0.62 * t + wob, ay + len * t * 0.32 + wob * 0.6]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    var i2;
    for (i2 = 0; i2 < pts.length; i2++) {
      var w = width * (1 - i2 / pts.length) / 2;
      if (i2 === 0) ctx.moveTo(pts[i2][0], pts[i2][1] + w);
      else ctx.lineTo(pts[i2][0], pts[i2][1] + w);
    }
    for (i2 = pts.length - 1; i2 >= 0; i2--) {
      var w2 = width * (1 - i2 / pts.length) / 2;
      ctx.lineTo(pts[i2][0], pts[i2][1] - w2);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawNinjaBody(phase, airborne, rolling, lean) {
    var suitDark = '#221a3d', suit = '#3b2f6b', sash = '#6ef7c1', band = '#ff6b8b', skin = '#f3c9a4';

    if (rolling) {
      // Tucked forward roll — a compact ball with the scarf whipping out.
      var spin = -G.time * 13;
      drawRibbon(0, 0.5, -1, G.time, 0.14, 0.42, band);
      ctx.save();
      ctx.translate(0, 0.44);
      ctx.rotate(spin);
      ctx.fillStyle = suit;
      ctx.beginPath(); ctx.arc(0, 0, 0.44, 0, 6.2832); ctx.fill();
      ctx.fillStyle = suitDark;
      ctx.beginPath(); ctx.arc(0, 0, 0.44, 0.5, 2.7); ctx.fill();
      ctx.strokeStyle = sash;
      ctx.lineWidth = 0.08;
      ctx.beginPath(); ctx.arc(0, 0, 0.3, 0.3, 3.3); ctx.stroke();
      ctx.fillStyle = suitDark;
      ctx.beginPath(); ctx.arc(0.2, 0.22, 0.13, 0, 6.2832); ctx.fill();
      ctx.restore();
      return;
    }

    var bob = airborne ? 0 : Math.sin(phase * 2) * 0.03;
    var swing = Math.sin(phase);
    var sway = airborne ? 0 : swing * 0.035;
    // Each limb alternates off its own half of the cycle. Driving both from
    // one mirrored term (the old bug) made the legs splay apart and snap back
    // together instead of striding.
    var liftL = Math.max(0, swing), liftR = Math.max(0, -swing);
    var hipY = 0.7 + bob;
    var shoulderY = 1.14 + bob;
    var headY = 1.44 + bob;
    var headR = 0.27;

    // Scarf and headband tails sit behind everything else.
    drawRibbon(-0.12, shoulderY + 0.08, -1, G.time, 0.15, 0.52, band);
    drawRibbon(-0.16, headY + 0.05, -1, G.time + 0.5, 0.085, 0.3, band);
    drawRibbon(0.16, headY + 0.05, 1, G.time + 0.2, 0.085, 0.26, band);

    // Legs
    var footL, footR;
    if (airborne) {
      footL = [-0.2, hipY - 0.46]; footR = [0.26, hipY - 0.3];
      limb(-0.1, hipY, -0.24, hipY - 0.26, footL[0], footL[1], 0.155, suitDark);
      limb(0.1, hipY, 0.26, hipY - 0.14, footR[0], footR[1], 0.155, suitDark);
    } else {
      var hipL = -0.1 + sway, hipR = 0.1 + sway;
      footL = [hipL - 0.015 + liftL * 0.045, hipY - 0.68 + liftL * 0.34];
      footR = [hipR + 0.015 - liftR * 0.045, hipY - 0.68 + liftR * 0.34];
      limb(hipL, hipY, hipL - 0.04 + liftL * 0.02, hipY - 0.36 + liftL * 0.11, footL[0], footL[1], 0.155, suitDark);
      limb(hipR, hipY, hipR + 0.04 - liftR * 0.02, hipY - 0.36 + liftR * 0.11, footR[0], footR[1], 0.155, suitDark);
    }
    // Tabi boots
    for (var b = 0; b < 2; b++) {
      var ft = b ? footR : footL;
      ctx.fillStyle = '#15102a';
      ctx.beginPath(); ctx.ellipse(ft[0], ft[1] - 0.03, 0.1, 0.065, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = rgba('#6ef7c1', 0.5);
      ctx.beginPath(); ctx.ellipse(ft[0], ft[1] - 0.055, 0.075, 0.022, 0, 0, 6.2832); ctx.fill();
    }

    ctx.save();
    ctx.translate(sway * 0.7, 0);

    // Torso, seen from behind
    var tg = ctx.createLinearGradient(-0.26, hipY, 0.26, shoulderY);
    tg.addColorStop(0, suitDark);
    tg.addColorStop(0.45, suit);
    tg.addColorStop(1, suitDark);
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(-0.19, hipY - 0.02);
    ctx.quadraticCurveTo(-0.25, shoulderY - 0.14, -0.21, shoulderY);
    ctx.quadraticCurveTo(0, shoulderY + 0.09, 0.21, shoulderY);
    ctx.quadraticCurveTo(0.25, shoulderY - 0.14, 0.19, hipY - 0.02);
    ctx.quadraticCurveTo(0, hipY - 0.1, -0.19, hipY - 0.02);
    ctx.closePath();
    ctx.fill();

    // Katana across the back
    ctx.strokeStyle = '#cfc8e6';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-0.2, hipY + 0.12);
    ctx.lineTo(0.2, shoulderY + 0.16);
    ctx.stroke();
    ctx.strokeStyle = '#18122c';
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(-0.19, hipY + 0.14);
    ctx.lineTo(0.02, shoulderY - 0.06);
    ctx.stroke();
    ctx.fillStyle = '#ffcf5c';
    ctx.beginPath(); ctx.arc(0.08, shoulderY + 0.01, 0.045, 0, 6.2832); ctx.fill();

    // Sash
    ctx.strokeStyle = sash;
    ctx.lineWidth = 0.075;
    ctx.beginPath();
    ctx.moveTo(-0.2, hipY + 0.05);
    ctx.quadraticCurveTo(0, hipY + 0.11, 0.2, hipY + 0.05);
    ctx.stroke();

    // Arms
    if (airborne) {
      limb(-0.19, shoulderY - 0.03, -0.34, shoulderY + 0.06, -0.4, shoulderY + 0.22, 0.115, suit);
      limb(0.19, shoulderY - 0.03, 0.34, shoulderY + 0.06, 0.4, shoulderY + 0.22, 0.115, suit);
    } else {
      var aL = -swing, aR = swing;
      limb(-0.19, shoulderY - 0.02, -0.25 - aL * 0.03, shoulderY - 0.2,
           -0.235 - aL * 0.06, shoulderY - 0.42 + aL * 0.17, 0.115, suit);
      limb(0.19, shoulderY - 0.02, 0.25 + aR * 0.03, shoulderY - 0.2,
           0.235 + aR * 0.06, shoulderY - 0.42 + aR * 0.17, 0.115, suit);
    }

    // Head: hood over a rounded mask
    ctx.fillStyle = suitDark;
    ctx.beginPath(); ctx.arc(0, headY, headR, 0, 6.2832); ctx.fill();
    ctx.fillStyle = suit;
    ctx.beginPath();
    ctx.arc(0, headY + 0.02, headR * 0.92, Math.PI * 0.08, Math.PI * 0.92);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.ellipse(-headR * 0.35, headY + headR * 0.3, headR * 0.3, headR * 0.16, -0.5, 0, 6.2832);
    ctx.fill();

    // A friendly glance back over the shoulder while strafing.
    if (Math.abs(lean) > 0.25) {
      var side = lean > 0 ? 1 : -1;
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(side * headR * 0.62, headY - 0.02, 0.085, 0.105, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#1d1633';
      ctx.beginPath();
      ctx.ellipse(side * headR * 0.72, headY - 0.02, 0.03, 0.05, 0, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(side * headR * 0.76, headY + 0.02, 0.014, 0, 6.2832);
      ctx.fill();
    }

    // Headband
    ctx.strokeStyle = band;
    ctx.lineWidth = 0.085;
    ctx.beginPath();
    ctx.moveTo(-headR * 0.94, headY + 0.08);
    ctx.quadraticCurveTo(0, headY + 0.15, headR * 0.94, headY + 0.08);
    ctx.stroke();

    ctx.restore();
  }

  function drawPlayer() {
    var s = scaleAt(CFG.playerZ);
    var x = projX(laneX(player.lanePos), CFG.playerZ, s);
    var feetY = projY(player.y, s);
    var shadowY = projY(player.groundY, s);
    var air = Math.max(0, player.y - player.groundY);

    // Ground shadow shrinks as the ninja rises.
    ctx.save();
    ctx.globalAlpha = clamp(0.42 - air * 0.1, 0.1, 0.42);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, shadowY, (0.42 - air * 0.035) * s, 0.13 * s, 0, 0, 6.2832);
    ctx.fill();
    ctx.restore();

    // Dash streaks
    if (G.powers.dash > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,207,92,0.5)';
      ctx.lineWidth = 3;
      for (var i = 0; i < 6; i++) {
        var off = rand(-0.6, 0.6) * s;
        ctx.beginPath();
        ctx.moveTo(x + off, feetY - rand(0.2, 1.6) * s);
        ctx.lineTo(x + off * 1.6, feetY + rand(0.4, 1.4) * s);
        ctx.stroke();
      }
      ctx.restore();
    }

    var blink = player.invuln > 0 && Math.floor(G.time * 16) % 2 === 0;
    if (!blink) {
      ctx.save();
      ctx.translate(x, feetY);
      ctx.rotate(player.lean * 0.14);
      ctx.scale(s, -s);
      drawNinjaBody(player.runPhase, !player.onGround, player.rolling > 0, player.lean);
      ctx.restore();
    }

    // Shield bubble
    if (G.powers.shield > 0) {
      var pulse = 0.55 + 0.25 * Math.sin(G.time * 6);
      var fading = G.powers.shield < 2 && Math.floor(G.time * 8) % 2 === 0;
      ctx.save();
      ctx.globalAlpha = fading ? 0.25 : pulse;
      ctx.strokeStyle = '#7eb8ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, feetY - 0.82 * s, 0.68 * s, 1.08 * s, 0, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#7eb8ff';
      ctx.fill();
      ctx.restore();
    }

    // Magnet aura
    if (G.powers.magnet > 0) {
      ctx.save();
      ctx.globalAlpha = 0.28 + 0.12 * Math.sin(G.time * 8);
      ctx.strokeStyle = '#6ef7c1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, feetY - 0.75 * s, 1.35 * s, 0.45 * s, 0, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ───────────────────────── Frame ───────────────────────── */
  var renderList = [];

  function drawFrame() {
    updatePalette();
    ctx.save();
    if (G.shake > 0) {
      var m = G.shake * 12;
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    drawSky();
    drawRoad();

    G.scenery.sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < G.scenery.length; i++) drawScenery(G.scenery[i]);

    drawAimWarnings();

    renderList.length = 0;
    for (i = 0; i < G.entities.length; i++) renderList.push(G.entities[i]);
    renderList.push({ kind: 'player', z: CFG.playerZ });
    renderList.sort(function (a, b) { return b.z - a.z; });

    for (i = 0; i < renderList.length; i++) {
      var e = renderList[i];
      if (e.kind === 'player') drawPlayer();
      else if (e.kind === 'obstacle') drawObstacle(e);
      else if (e.kind === 'coin') drawCoin(e);
      else if (e.kind === 'power') drawPower(e);
      else if (e.kind === 'enemy') drawEnemy(e);
      else if (e.kind === 'star') drawStar(e);
    }

    // Speed lines once the run gets fast
    var fast = clamp((G.speed - 24) / 15, 0, 1) + (G.powers.dash > 0 ? 0.6 : 0);
    if (fast > 0.02) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.26, fast * 0.24);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      for (i = 0; i < 9; i++) {
        var a = (i / 9) * 6.2832 + G.time * 0.6;
        var r0 = view.h * 0.46, r1 = r0 + view.h * rand(0.1, 0.22);
        ctx.beginPath();
        ctx.moveTo(view.cx + Math.cos(a) * r0, view.horizon + Math.sin(a) * r0);
        ctx.lineTo(view.cx + Math.cos(a) * r1, view.horizon + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Particles
    for (i = 0; i < G.particles.length; i++) {
      var p = G.particles[i];
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Floating score pops
    ctx.textAlign = 'center';
    ctx.font = '700 15px system-ui, sans-serif';
    for (i = 0; i < G.floaters.length; i++) {
      var f = G.floaters[i];
      ctx.globalAlpha = clamp(f.life / 0.8, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Vignette + damage flash
    var vg = ctx.createRadialGradient(view.cx, view.h * 0.5, view.h * 0.3, view.cx, view.h * 0.5, view.h * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, view.w, view.h);

    if (G.flash > 0) {
      ctx.fillStyle = 'rgba(255,107,139,' + (G.flash * 0.5) + ')';
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  /* ───────────────────────── HUD & UI ───────────────────────── */
  var el = {};
  ['hud', 'hudScore', 'hudDistance', 'hudCoins', 'hudLives', 'hudMultiplier', 'hudPowerups',
   'menu', 'menuBest', 'menuCoins', 'pauseScreen', 'pauseScore', 'pauseDistance', 'pauseCoins',
   'gameOver', 'overTitle', 'overScore', 'overDistance', 'overCoins', 'overBest', 'overBestTag',
   'playBtn', 'resumeBtn', 'quitBtn', 'againBtn', 'menuBtn', 'pauseBtn', 'soundBtn',
   'hudRival', 'hudRivalName', 'hudRivalScore', 'rivalBanner', 'rivalName', 'rivalScore',
   'rivalClear', 'rivalResult', 'shareBtn', 'shareMenuBtn', 'nameInput']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  function bumpHud(id) {
    var node = el[id];
    if (!node) return;
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  function renderLives() {
    var html = '';
    for (var i = 0; i < CFG.lives; i++) {
      html += '<span class="heart' + (i < G.lives ? '' : ' lost') + '">❤️</span>';
    }
    el.hudLives.innerHTML = html;
  }

  var powerOrder = ['dash', 'shield', 'magnet', 'double'];
  function renderPowerups() {
    var html = '';
    for (var i = 0; i < powerOrder.length; i++) {
      var k = powerOrder[i];
      var t = G.powers[k];
      if (t <= 0) continue;
      var def = POWERS[k];
      var pct = Math.round((t / def.time) * 100);
      html += '<div class="pw"><span>' + def.icon + '</span><span class="pw-bar">' +
        '<span class="pw-fill" style="width:' + pct + '%;background:' + def.color + '"></span></span></div>';
    }
    el.hudPowerups.innerHTML = html;
    el.hudMultiplier.classList.toggle('hidden', G.powers.double <= 0);
  }

  var hudCache = { score: -1, dist: -1, coins: -1, powers: '' };
  function renderHud() {
    var score = Math.floor(G.score);
    var dist = Math.floor(G.distance);
    if (score !== hudCache.score) { el.hudScore.textContent = score.toLocaleString(); hudCache.score = score; }
    if (dist !== hudCache.dist) { el.hudDistance.textContent = dist + 'm'; hudCache.dist = dist; }
    if (G.coins !== hudCache.coins) { el.hudCoins.textContent = G.coins; hudCache.coins = G.coins; }
    var sig = powerOrder.map(function (k) { return Math.ceil(G.powers[k] * 4); }).join(',');
    if (sig !== hudCache.powers) { renderPowerups(); hudCache.powers = sig; }
  }

  function show(node, visible) { node.classList.toggle('hidden', !visible); }

  /* ── Score sharing ──
     The site is static, so scores travel as challenge links: a shared URL
     carries the sender's name and best score, and whoever opens it runs
     against that number. */
  function cleanName(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 14);
  }

  function readChallenge() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var score = parseInt(params.get('best'), 10);
    if (!isFinite(score) || score <= 0) return;
    Store.data.rival = { name: cleanName(params.get('by')) || 'A ninja', score: Math.min(score, 99999999) };
    Store.save();
    // Strip the query so a refresh doesn't keep re-applying the same challenge.
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    } catch (e2) { /* ignore */ }
  }

  function challengeUrl(name, best) {
    var base = window.location.origin + window.location.pathname;
    return base + '?by=' + encodeURIComponent(name) + '&best=' + best;
  }

  function copyText(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { onDone(true); }, function () { onDone(legacyCopy(text)); });
    } else {
      onDone(legacyCopy(text));
    }
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function shareBest() {
    var best = Math.floor(Store.data.best);
    if (best <= 0) { toast('Finish a run first'); return; }
    var name = cleanName(el.nameInput.value) || cleanName(Store.data.name) || 'A ninja';
    Store.data.name = name;
    Store.save();
    el.nameInput.value = name;

    var url = challengeUrl(name, best);
    var text = name + ' scored ' + best.toLocaleString() + ' in Shadow Step. Can you beat it?';

    if (navigator.share) {
      navigator.share({ title: 'Shadow Step', text: text, url: url }).catch(function () { /* dismissed */ });
      return;
    }
    copyText(url, function (ok) {
      if (ok) toast('Challenge link copied');
      else window.prompt('Copy your challenge link', url);
    });
  }

  function renderRival() {
    var rival = Store.data.rival;
    show(el.rivalBanner, !!rival);
    if (rival) {
      el.rivalName.textContent = rival.name;
      el.rivalScore.textContent = rival.score.toLocaleString();
      el.hudRivalName.textContent = rival.name;
      el.hudRivalScore.textContent = rival.score.toLocaleString();
      el.hudRival.classList.toggle('beaten', G.rivalBeaten);
    }
    show(el.hudRival, !!rival && G.state === STATE.PLAY);
    show(el.shareMenuBtn, Store.data.best > 0);
  }

  function clearRival() {
    Store.data.rival = null;
    Store.save();
    renderRival();
  }

  function setMenuStats() {
    el.menuBest.textContent = Math.floor(Store.data.best).toLocaleString();
    el.menuCoins.textContent = Store.data.coins.toLocaleString();
    renderRival();
  }

  function startRun() {
    Audio2.init();
    Audio2.resume();
    resetRun();
    hudCache.score = hudCache.dist = hudCache.coins = -1;
    hudCache.powers = '';
    G.state = STATE.PLAY;
    renderLives();
    renderHud();
    show(el.menu, false);
    show(el.gameOver, false);
    show(el.pauseScreen, false);
    show(el.pauseBtn, true);
    show(el.hud, true);
    renderRival();
    Audio2.play('start');
    toast('Go!');
  }

  function endRun() {
    G.state = STATE.OVER;
    Audio2.play('over');
    var score = Math.floor(G.score);
    Store.data.coins += G.coins;
    Store.data.runs += 1;
    Store.data.far = Math.max(Store.data.far, Math.floor(G.distance));
    G.newBest = score > Store.data.best;
    if (G.newBest) Store.data.best = score;
    Store.save();

    el.overScore.textContent = score.toLocaleString();
    el.overDistance.textContent = Math.floor(G.distance) + 'm';
    el.overCoins.textContent = G.coins;
    el.overBest.textContent = Math.floor(Store.data.best).toLocaleString();
    el.overTitle.textContent = G.newBest ? 'New Record!' : 'Run Complete';
    show(el.overBestTag, G.newBest);

    var rival = Store.data.rival;
    if (rival) {
      var diff = score - rival.score;
      el.rivalResult.textContent = diff > 0
        ? 'You beat ' + rival.name + ' by ' + diff.toLocaleString() + '!'
        : rival.name + ' still leads by ' + Math.abs(diff).toLocaleString();
      el.rivalResult.classList.toggle('missed', diff <= 0);
    }
    show(el.rivalResult, !!rival);
    el.nameInput.value = cleanName(Store.data.name);
    show(el.pauseScreen, false);
    show(el.gameOver, true);
    show(el.pauseBtn, false);
    show(el.hud, false);
    setMenuStats();
  }

  function togglePause() {
    if (G.state === STATE.PLAY) {
      G.state = STATE.PAUSE;
      el.pauseScore.textContent = Math.floor(G.score).toLocaleString();
      el.pauseDistance.textContent = Math.floor(G.distance) + 'm';
      el.pauseCoins.textContent = G.coins;
      show(el.pauseScreen, true);
    } else if (G.state === STATE.PAUSE) {
      G.state = STATE.PLAY;
      show(el.pauseScreen, false);
    }
  }

  function toMenu() {
    G.state = STATE.MENU;
    setMenuStats();
    show(el.pauseScreen, false);
    show(el.gameOver, false);
    show(el.menu, true);
    show(el.pauseBtn, false);
    show(el.hud, false);
  }

  function toggleSound() {
    Audio2.init();
    var on = Audio2.toggle();
    el.soundBtn.textContent = on ? '🔊' : '🔇';
    el.soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }

  el.playBtn.addEventListener('click', startRun);
  el.againBtn.addEventListener('click', startRun);
  el.menuBtn.addEventListener('click', toMenu);
  el.resumeBtn.addEventListener('click', togglePause);
  el.quitBtn.addEventListener('click', function () { endRun(); });
  el.pauseBtn.addEventListener('click', togglePause);
  el.soundBtn.addEventListener('click', toggleSound);
  el.shareBtn.addEventListener('click', shareBest);
  el.shareMenuBtn.addEventListener('click', shareBest);
  el.rivalClear.addEventListener('click', clearRival);
  el.nameInput.addEventListener('keydown', function (e) { e.stopPropagation(); });

  /* ───────────────────────── Main loop ───────────────────────── */
  var last = 0;
  var MAX_STEP = 1 / 90;

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;   // tab was backgrounded

    if (G.state === STATE.PLAY) {
      var remaining = dt;
      while (remaining > 0) {
        var slice = Math.min(MAX_STEP, remaining);
        step(slice);
        remaining -= slice;
        if (G.state !== STATE.PLAY) break;
      }
      renderHud();
    } else {
      G.time += dt;
      updateParticles(dt);
      if (G.state === STATE.MENU) {
        // Idle attract mode: the world keeps drifting behind the title card.
        G.worldZ += dt * 8;
        for (var i = G.scenery.length - 1; i >= 0; i--) {
          G.scenery[i].z -= dt * 8;
          if (G.scenery[i].z < 1) G.scenery.splice(i, 1);
        }
        G.scenerySpawnZ -= dt * 8;
        while (G.scenerySpawnZ < CFG.drawDist) { addScenery(G.scenerySpawnZ); G.scenerySpawnZ += rand(5.5, 11); }
      }
    }
    drawFrame();
  }

  /* ───────────────────────── Boot ───────────────────────── */
  resize();
  resetRun();
  readChallenge();
  setMenuStats();
  renderLives();
  el.soundBtn.textContent = Audio2.on ? '🔊' : '🔇';
  show(el.pauseBtn, false);
  show(el.hud, false);
  requestAnimationFrame(frame);

  window.ShadowStep = {
    G: G, player: player, CFG: CFG, OBSTACLES: OBSTACLES, STATE: STATE, Store: Store,
    moveLane: moveLane, jump: doJump, roll: doRoll, start: startRun, laneX: laneX,
    challengeUrl: challengeUrl, makeEnemy: makeEnemy, makeStar: makeStar, FX: FX,
    makeObstacle: makeObstacle, makeCoin: makeCoin, makePower: makePower
  };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline play is optional */ });
    });
  }
})();
