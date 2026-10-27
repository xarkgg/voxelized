(function () {
  "use strict";

  var DEFAULT_URL = "https://enzo.fyi";
  var DEFAULT_EMOJI = "🌸";
  var DEG = Math.PI / 180;
  var ISO_PHI = 55 * DEG, ISO_YAW = 45 * DEG;
  var DARK_MAX = 0.3;   // max relative luminance of a dark module's top face
  var LIGHT_MIN = 0.75; // min relative luminance of a light module's top face

  var canvas = document.getElementById("c");
  var stage = document.getElementById("stage");
  var shadowEl = document.getElementById("shadow");
  var input = document.getElementById("url");
  var toggleBtn = document.getElementById("toggle");
  var chipsEl = document.getElementById("chips");
  var emojiRow = document.getElementById("emojiRow");
  var emojiInput = document.getElementById("emoji");
  var M = window.VoxelModels;

  var renderer = null;
  if (typeof THREE !== "undefined") {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { renderer = null; }
  }
  if (!renderer || typeof qrcode === "undefined" || !M) {
    document.body.classList.add("no-webgl");
    document.getElementById("hint").textContent = "This browser can't run WebGL, so the 3D view is unavailable.";
    return;
  }

  // ---------- colour helpers ----------
  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }
  function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
  function darken(rgb, maxY) {
    var y = lum(rgb);
    if (y <= maxY) return rgb;
    var f = Math.pow(maxY / y, 1 / 2.2);
    for (var i = 0; i < 6 && lum(rgb) > maxY; i++) {
      rgb = [rgb[0] * f, rgb[1] * f, rgb[2] * f];
      f = 0.95;
    }
    return rgb;
  }
  function lighten(rgb, minY) {
    var t = 0;
    var out = rgb;
    while (lum(out) < minY && t < 1) {
      t += 0.05;
      out = [rgb[0] + (1 - rgb[0]) * t, rgb[1] + (1 - rgb[1]) * t, rgb[2] + (1 - rgb[2]) * t];
    }
    return out;
  }
  function hash(x, y, s) {
    var h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  }
  function jitter(rgb, h, amt) {
    var k = 1 + (h - 0.5) * amt;
    return [Math.min(1, rgb[0] * k), Math.min(1, rgb[1] * k), Math.min(1, rgb[2] * k)];
  }
  function pick(arr, h) { return arr[Math.floor(h * arr.length) % arr.length]; }

  // ---------- QR ----------
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs["UTF-8"]) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  }
  function makeMatrix(text) {
    try {
      var q = qrcode(0, "H");
      q.addData(text || DEFAULT_URL);
      q.make();
      var n = q.getModuleCount(), m = [];
      for (var r = 0; r < n; r++) {
        var row = [];
        for (var c = 0; c < n; c++) row.push(q.isDark(r, c));
        m.push(row);
      }
      return m;
    } catch (e) { return null; }
  }

  // ---------- scene ----------
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
  var camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  var ambient = new THREE.AmbientLight(0xffffff, 0.85);
  var sun = new THREE.DirectionalLight(0xffffff, 0.15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  scene.add(ambient, sun, sun.target);

  var geo = new THREE.BoxGeometry(1, 1, 1);
  var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  var mesh = null;
  var tmpColor = new THREE.Color();

  var state = { modelKey: "cherry", emoji: DEFAULT_EMOJI };
  var N = 0, prevMatrix = null, prevModelKey = null, objTop = 10;
  var inst = null, popStart = 0, popEnd = 0, dirty = true;

  function currentModel(R) {
    if (state.modelKey === "emoji") return M.emoji(state.emoji, R);
    return M.MODELS[state.modelKey];
  }

  function build(m) {
    var n = m.length;
    var R = 0.4 * n;
    var cx = (n - 1) / 2;
    var model = currentModel(R);
    var sameScene = prevMatrix && prevMatrix.length === n && prevModelKey === state.modelKey + state.emoji;
    N = n + 2;
    var half = N / 2;

    function inFinder(r, c) {
      return (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
    }
    function isGround(r, c) {
      if ((r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)) return true;
      return (r === 6 && c >= 8 && c <= n - 9) || (c === 6 && r >= 8 && r <= n - 9);
    }

    // anchor: nearest all-dark 2x2 block to the centre (used by thin parts like a trunk)
    var anchor = { u: 0, v: 0 }, best = 1e9, ci = Math.round(cx);
    for (var dr = -5; dr <= 5; dr++) for (var dc = -5; dc <= 5; dc++) {
      var r0 = ci - 1 + dr, c0 = ci - 1 + dc;
      if (r0 < 0 || c0 < 0 || r0 + 1 >= n || c0 + 1 >= n) continue;
      if (m[r0][c0] && m[r0 + 1][c0] && m[r0][c0 + 1] && m[r0 + 1][c0 + 1]) {
        var d = dr * dr + dc * dc;
        if (d < best) { best = d; anchor = { u: (c0 + 0.5 - cx) / R, v: (r0 + 0.5 - cx) / R }; }
      }
    }

    // 1. sample the model into columns
    var yMax = Math.ceil(R * 2.3);
    var cols = {};   // "r,c" -> [{y, rgb}]
    var occ = {};    // "r,c,y" -> 1
    var dominant = [0, 0, 0], domCount = 0;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (inFinder(r, c)) continue;
        var U = (c - cx) / R, V = (r - cx) / R;
        if (Math.abs(U) > 1.3 || Math.abs(V) > 1.3) continue;
        var list = null;
        for (var y = 1; y <= yMax; y++) {
          var hex = model.field(U, V, (y - 0.5) / R, hash(c, r * 31 + y, 3), anchor);
          if (!hex) continue;
          (list || (list = [])).push({ y: y, rgb: jitter(hexToRgb(hex), hash(c + y, r, 7), 0.08) });
        }
        if (!list) continue;

        // 2. enforce the scan rule on the topmost voxel
        var top = list[list.length - 1];
        if (m[r][c]) {
          top.rgb = darken(top.rgb, DARK_MAX);
          dominant[0] += top.rgb[0]; dominant[1] += top.rgb[1]; dominant[2] += top.rgb[2]; domCount++;
        } else if (model.mode === "drop") {
          continue;
        } else {
          top.rgb = lighten(jitter(hexToRgb(model.light), hash(c, r, 9), 0.04), LIGHT_MIN);
        }
        cols[r + "," + c] = list;
        for (var i = 0; i < list.length; i++) occ[r + "," + c + "," + list[i].y] = 1;
      }
    }

    var darkPalette = model.dark ? model.dark.map(function (h) { return darken(hexToRgb(h), DARK_MAX); })
      : [darken(domCount ? [dominant[0] / domCount, dominant[1] / domCount, dominant[2] / domCount] : hexToRgb("#d94f93"), DARK_MAX)];
    var groundPalette = model.ground.map(function (h) { return darken(hexToRgb(h), DARK_MAX); });
    var cream = hexToRgb("#f3efe4");
    var quiet = [hexToRgb("#eef2e0"), hexToRgb("#f3efe4"), hexToRgb("#e9f0dc")];

    // 3. instances
    var P = [], S = [], C = [], D = [];
    function changed(r, c) {
      if (!sameScene) return true;
      if (r < 0 || c < 0 || r >= n || c >= n) return false;
      return prevMatrix[r][c] !== m[r][c];
    }
    function push(x, y, z, s, rgb, delay) { P.push(x, y, z); S.push(s); C.push(rgb[0], rgb[1], rgb[2]); D.push(delay); }

    var maxTop = 1;
    for (var gr = 0; gr < N; gr++) {
      for (var gc = 0; gc < N; gc++) {
        var rr = gr - 1, cc = gc - 1;
        var x = gc - half + 0.5, z = gr - half + 0.5;
        var border = rr < 0 || cc < 0 || rr >= n || cc >= n;
        var dist = Math.hypot(rr - cx, cc - cx);
        var ch = changed(rr, cc);
        var baseDelay = ch ? (dist / n) * 0.32 : -1;
        var hb = hash(gc, gr, 5);
        var rgb;
        if (border) rgb = pick(quiet, hb);
        else if (!m[rr][cc]) rgb = jitter(cream, hb, 0.04);
        else if (isGround(rr, cc)) rgb = jitter(pick(groundPalette, hb), hash(gr, gc, 6), 0.06);
        else rgb = jitter(pick(darkPalette, hb), hash(gr, gc, 6), 0.06);
        if (!border && m[rr][cc]) rgb = darken(rgb, DARK_MAX);
        push(x, 0.5, z, 1, rgb, baseDelay);

        if (border) continue;
        var colList = cols[rr + "," + cc];
        if (!colList) continue;
        for (var k = 0; k < colList.length; k++) {
          var vy = colList[k].y;
          var kp = rr + "," + cc + ",";
          var hidden = k < colList.length - 1 &&
            occ[kp + (vy - 1)] && occ[kp + (vy + 1)] &&
            occ[(rr - 1) + "," + cc + "," + vy] && occ[(rr + 1) + "," + cc + "," + vy] &&
            occ[rr + "," + (cc - 1) + "," + vy] && occ[rr + "," + (cc + 1) + "," + vy];
          if (hidden) continue;
          if (vy + 1 > maxTop) maxTop = vy + 1;
          push(x, vy + 0.5, z, 0.98, colList[k].rgb, ch ? 0.12 + (dist / n) * 0.3 + vy * 0.012 : -1);
        }
      }
    }
    objTop = maxTop;

    var count = S.length;
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (var j = 0; j < count; j++) {
      tmpColor.setRGB(C[j * 3], C[j * 3 + 1], C[j * 3 + 2]);
      mesh.setColorAt(j, tmpColor);
    }
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    inst = { pos: P, scl: S, delay: D, count: count };

    var maxDelay = 0;
    for (var q = 0; q < count; q++) if (D[q] > maxDelay) maxDelay = D[q];
    popStart = performance.now() / 1000;
    popEnd = popStart + maxDelay + 0.45;
    applyPop(popStart, true);

    var sc = sun.shadow.camera, ext = N * 0.9 + objTop * 0.3;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.updateProjectionMatrix();

    prevMatrix = m;
    prevModelKey = state.modelKey + state.emoji;
    dirty = true;
  }

  var dummy = new THREE.Object3D();
  function easeOutBack(x) {
    var c1 = 1.9, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
  function applyPop(now, force) {
    if (!inst) return;
    var P = inst.pos, S = inst.scl, D = inst.delay;
    var anim = now < popEnd;
    if (!anim && !force && inst.settled) return;
    for (var i = 0; i < inst.count; i++) {
      var k = 1;
      if (D[i] >= 0 && anim) {
        var p = (now - popStart - D[i]) / 0.36;
        k = p <= 0 ? 0 : p >= 1 ? 1 : easeOutBack(p);
      }
      var s = S[i] * Math.max(k, 0.0001);
      dummy.position.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    inst.settled = !anim;
  }

  // ---------- springs ----------
  function Spring(x) { this.x = x; this.v = 0; this.target = x; }
  Spring.prototype.step = function (dt) {
    var a = 110 * (this.target - this.x) - 12 * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  };
  Spring.prototype.rest = function () {
    return Math.abs(this.target - this.x) < 1e-4 && Math.abs(this.v) < 1e-4;
  };
  var tS = new Spring(0), yawS = new Spring(0);
  var mode3D = false, dragging = false, drag = null;
  var hover = { t: 0, yaw: 0, on: false };
  var tilt = { on: false, t: 0, yaw: 0, beta0: null, gamma0: null };

  function setToggleUI() {
    var bs = toggleBtn.querySelectorAll("b");
    bs[0].classList.toggle("is-on", !mode3D);
    bs[1].classList.toggle("is-on", mode3D);
    toggleBtn.setAttribute("aria-pressed", mode3D ? "true" : "false");
  }
  function updateTargets() {
    if (dragging) { tS.target = drag.t; yawS.target = drag.yaw; }
    else if (mode3D) { tS.target = 1; yawS.target = 0; }
    else if (tilt.on) { tS.target = tilt.t; yawS.target = tilt.yaw; }
    else if (hover.on) { tS.target = hover.t; yawS.target = hover.yaw; }
    else { tS.target = 0; yawS.target = 0; }
  }

  // ---------- camera ----------
  var target = new THREE.Vector3();
  var lightIso = new THREE.Vector3(-0.62, 1.15, -0.28).normalize();
  var lightDir = new THREE.Vector3();
  function placeCamera(t, yawOff, exportPad) {
    var tc = Math.max(-0.2, t);
    var phi = tc * ISO_PHI;
    var yaw = tc * ISO_YAW + yawOff * Math.min(1, Math.abs(tc) * 4);
    var tl = Math.min(1, Math.max(0, t));
    var tl2 = tl * tl * (3 - 2 * tl);
    var halfFlat = exportPad ? N / 2 + 2.5 : N / 2 * 1.015;
    var halfIso = N * 0.66 + objTop * 0.32;
    var h = halfFlat + (halfIso - halfFlat) * tl2;
    camera.left = -h; camera.right = h; camera.top = h; camera.bottom = -h;
    camera.updateProjectionMatrix();
    target.set(0, 1 + (objTop * 0.42 - 1) * tl2, 0);
    var dist = 160;
    var sp = Math.sin(phi), cp = Math.cos(phi), sy = Math.sin(yaw), cy = Math.cos(yaw);
    camera.position.set(target.x + dist * sp * sy, target.y + dist * cp, target.z + dist * sp * cy);
    camera.up.set(-sy, 0, -cy);
    camera.lookAt(target);

    lightDir.set(0, 1, 0).lerp(lightIso, tl2).normalize();
    var ly = yaw - ISO_YAW;
    var lx = lightDir.x * Math.cos(ly) + lightDir.z * Math.sin(ly);
    var lz = -lightDir.x * Math.sin(ly) + lightDir.z * Math.cos(ly);
    sun.position.set(lx * 90, lightDir.y * 90, lz * 90);
    sun.target.position.set(0, 0, 0);
    ambient.intensity = 0.85 - 0.37 * tl2;
    sun.intensity = 0.15 + 0.6 * tl2;
  }

  function resize() {
    var s = Math.max(1, Math.round(stage.getBoundingClientRect().width));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(s, s, false);
    dirty = true;
  }
  window.addEventListener("resize", resize);

  var last = performance.now();
  function frame(nowMs) {
    var dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    updateTargets();
    var moving = !tS.rest() || !yawS.rest();
    if (moving) {
      var steps = Math.ceil(dt / 0.008);
      for (var i = 0; i < steps; i++) { tS.step(dt / steps); yawS.step(dt / steps); }
      if (tS.rest()) { tS.x = tS.target; tS.v = 0; }
      if (yawS.rest()) { yawS.x = yawS.target; yawS.v = 0; }
    }
    var now = nowMs / 1000;
    var popping = inst && (now < popEnd || !inst.settled);
    if (popping) applyPop(now, false);
    if (moving || popping || dirty) {
      placeCamera(tS.x, yawS.x, false);
      var tl = Math.max(0, Math.min(1.2, tS.x));
      shadowEl.style.transform = "scale(" + (0.82 + 0.38 * tl).toFixed(3) + "," + (0.5 + 0.9 * tl).toFixed(3) + ")";
      shadowEl.style.opacity = (0.35 + 0.65 * Math.min(1, tl)).toFixed(3);
      renderer.render(scene, camera);
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  function rebuild() {
    var m = makeMatrix(input.value.trim() || DEFAULT_URL);
    if (m) build(m);
  }

  // ---------- object picker ----------
  function renderChips() {
    var keys = M.ORDER.concat(["emoji", "random"]);
    chipsEl.innerHTML = "";
    keys.forEach(function (key) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.key = key;
      b.textContent = key === "emoji" ? "Emoji" : key === "random" ? "Random" : M.MODELS[key].label;
      b.setAttribute("aria-pressed", key === state.modelKey ? "true" : "false");
      chipsEl.appendChild(b);
    });
  }
  function selectModel(key) {
    if (key === "random") {
      var pool = M.ORDER.filter(function (k) { return k !== state.modelKey; });
      key = pool[Math.floor(Math.random() * pool.length)];
    }
    state.modelKey = key;
    emojiRow.hidden = key !== "emoji";
    Array.prototype.forEach.call(chipsEl.children, function (b) {
      b.setAttribute("aria-pressed", b.dataset.key === key ? "true" : "false");
    });
    var chip = chipsEl.querySelector('[data-key="' + key + '"]');
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    rebuild();
  }
  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (b) selectModel(b.dataset.key);
  });
  var emojiDebounce = null;
  emojiInput.addEventListener("input", function () {
    clearTimeout(emojiDebounce);
    emojiDebounce = setTimeout(function () {
      var v = emojiInput.value.trim();
      var chars = Array.from ? Array.from(v) : [v];
      // keep the last grapheme-ish chunk (emoji with modifiers can span several code points)
      state.emoji = v ? (typeof Intl !== "undefined" && Intl.Segmenter
        ? Array.from(new Intl.Segmenter().segment(v)).pop().segment
        : chars[chars.length - 1]) : DEFAULT_EMOJI;
      rebuild();
    }, 150);
  });

  // ---------- input ----------
  var debounce = null;
  input.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(rebuild, 120);
  });
  toggleBtn.addEventListener("click", function () { mode3D = !mode3D; setToggleUI(); });

  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    canvas.classList.add("is-drag");
    drag = { x: e.clientX, y: e.clientY, t0: tS.x, yaw0: yawS.x, t: tS.x, yaw: yawS.x, id: e.pointerId };
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragging && drag && e.pointerId === drag.id) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      var size = canvas.clientWidth || 300;
      drag.t = Math.max(0, Math.min(1, drag.t0 + dy / (size * 0.42) + Math.abs(dx) / (size * 0.9)));
      drag.yaw = drag.yaw0 + (dx / size) * 2.4;
      return;
    }
    if (e.pointerType === "mouse") {
      var r = canvas.getBoundingClientRect();
      var nx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      var ny = ((e.clientY - r.top) / r.height - 0.5) * 2;
      hover.on = true;
      hover.t = 0.15 * Math.min(1, Math.hypot(nx, ny));
      hover.yaw = nx * 0.5;
    }
  });
  function endDrag(e) {
    if (!dragging || !drag || e.pointerId !== drag.id) return;
    dragging = false;
    drag = null;
    canvas.classList.remove("is-drag");
    if (mode3D) { mode3D = false; setToggleUI(); }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hover.on = false; });

  // ---------- device tilt (opt-in, switchable) ----------
  var tiltBtn = document.getElementById("tilt");
  var tiltListening = false;
  function onOrient(e) {
    if (!tiltEnabled || e.beta == null || e.gamma == null) return;
    if (tilt.beta0 === null) { tilt.beta0 = e.beta; tilt.gamma0 = e.gamma; }
    var db = e.beta - tilt.beta0, dg = e.gamma - tilt.gamma0;
    tilt.on = true;
    tilt.t = Math.min(1, Math.max(0, (Math.hypot(db, dg) - 3) / 22));
    tilt.yaw = Math.max(-1, Math.min(1, dg / 30)) * 0.6;
  }
  var tiltEnabled = false;
  function setTilt(on) {
    tiltEnabled = on;
    tilt.on = false;
    tilt.beta0 = null;          // recalibrate to however the phone is held right now
    tiltBtn.setAttribute("aria-pressed", on ? "true" : "false");
    tiltBtn.innerHTML = on ? "Tilt <b>on</b>" : "Tilt off";
    if (on && !tiltListening) { window.addEventListener("deviceorientation", onOrient); tiltListening = true; }
  }
  var canTilt = typeof window.DeviceOrientationEvent !== "undefined" &&
    (("ontouchstart" in window) || navigator.maxTouchPoints > 0);
  if (canTilt) {
    tiltBtn.hidden = false;
    setTilt(false);
    tiltBtn.addEventListener("click", function () {
      if (tiltEnabled) { setTilt(false); return; }
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission().then(function (s) {
          if (s === "granted") setTilt(true);
          else tiltBtn.textContent = "Tilt blocked";
        }).catch(function () { tiltBtn.textContent = "Tilt unavailable"; });
      } else {
        setTilt(true);
      }
    });
  }

  // ---------- export ----------
  var saveEl = document.getElementById("save");
  var saveImg = document.getElementById("saveImg");
  var saveHint = document.getElementById("saveHint");
  document.getElementById("saveClose").addEventListener("click", function () { saveEl.hidden = true; });

  function exportPNG(kind, btn, label) {
    if (!mesh) return;
    popEnd = 0;
    applyPop(performance.now() / 1000, true);
    var prevRatio = renderer.getPixelRatio();
    var size = new THREE.Vector2();
    renderer.getSize(size);
    renderer.setPixelRatio(1);
    renderer.setSize(1200, 1200, false);
    if (kind === "qr") {
      renderer.setClearColor(0xffffff, 1);
      placeCamera(0, 0, true);
    } else {
      renderer.setClearColor(0x000000, 0);   // transparent background for the object shot
      placeCamera(1, tS.x > 0.5 ? yawS.x : 0, false);
    }
    renderer.render(scene, camera);
    var url = canvas.toDataURL("image/png");
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(size.x, size.y, false);
    dirty = true;

    var slug = (input.value.trim() || DEFAULT_URL).replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);
    var name = (kind === "qr" ? "voxel-qr-" : "voxel-3d-") + (slug || "link") + ".png";
    try {
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {}
    var framed = false;
    try { framed = window.self !== window.top; } catch (err) { framed = true; }
    if (framed) {
      saveImg.src = url;
      saveImg.alt = kind === "qr" ? "Flat QR code" : "3D voxel object";
      saveImg.classList.toggle("is-3d", kind !== "qr");
      saveEl.hidden = false;
    }
    btn.textContent = "Saved ✓";
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = label; }, 1600);
  }
  var dlQR = document.getElementById("dlQr");
  var dl3D = document.getElementById("dl3d");
  dlQR.addEventListener("click", function () { exportPNG("qr", dlQR, "Save QR"); });
  dl3D.addEventListener("click", function () { exportPNG("3d", dl3D, "Save 3D"); });

  // ---------- start ----------
  renderChips();
  resize();
  rebuild();
  requestAnimationFrame(frame);
})();
