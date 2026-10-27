/*
 * Voxel models that grow on top of the QR code.
 *
 * Every model is a field: field(U, V, Y, h) returns a hex colour or null.
 *   U, V  horizontal position in units of R (R = 0.4 * QR module count), 0 at the centre
 *   Y     height above the base in units of R
 *   h     deterministic random in [0, 1) for this voxel, for colour variation
 *
 * mode decides what happens to object voxels standing over LIGHT QR modules:
 *   "drop"  remove them, so only dark columns carry the object (cherry tree look)
 *   "tint"  keep them, but repaint the topmost voxel with the model's light colour
 * The engine enforces the scan rule afterwards either way.
 */
(function (global) {
  "use strict";

  function pick(arr, h) { return arr[Math.floor(h * arr.length) % arr.length]; }
  function wobble(U, V, Y) {
    return 0.5 + 0.22 * Math.sin(U * 6.2 + 1.3) * Math.cos(V * 5.5 - 0.4) +
      0.18 * Math.sin((U + Y) * 4.1 + 2.1) + 0.1 * Math.cos((V - Y) * 9.0 + 0.7);
  }

  var MODELS = {
    cherry: {
      label: "Cherry tree",
      mode: "drop",
      ground: ["#3e9b4a", "#2f8a3d"],
      dark: ["#e86aa6", "#e0609c", "#d94f93"],
      light: "#f6e7ef",
      field: function (U, V, Y, h, a) {
        var tu = U - a.u, tv = V - a.v;
        if (Math.abs(tu) < 0.09 && Math.abs(tv) < 0.09 && Y < 0.75) return pick(["#5a3a22", "#6b4529", "#4d3019"], h);
        var d = Math.hypot(U, V, (Y - 0.95) / 0.55);
        if (d < 0.85 + 0.25 * wobble(U, V, Y) && Y > 0.55) return pick(["#d94f93", "#e86aa6", "#f39cc5", "#c23d7e"], h);
        return null;
      }
    },

    pine: {
      label: "Pine tree",
      mode: "tint",
      ground: ["#2d6e3e", "#245a33"],
      dark: ["#2f7a45", "#2a6b3d"],
      light: "#f4f8ff",
      field: function (U, V, Y, h) {
        var r = Math.hypot(U, V);
        if (r < 0.1 && Y < 0.4) return pick(["#5a3a22", "#4d3019"], h);
        var tiers = [[0.25, 0.95, 0.9], [0.75, 0.75, 0.75], [1.2, 0.55, 0.65], [1.6, 0.35, 0.5]];
        for (var i = 0; i < tiers.length; i++) {
          var base = tiers[i][0], rad = tiers[i][1], ht = tiers[i][2];
          var k = (Y - base) / ht;
          if (k >= 0 && k <= 1 && r <= rad * (1 - k)) return pick(["#1f6b3a", "#2d7d46", "#3a8f50", "#1a5c32"], h);
        }
        return null;
      }
    },

    mushroom: {
      label: "Mushroom",
      mode: "tint",
      ground: ["#4f8a3a", "#3f7a30"],
      dark: ["#c8242f", "#b81f2a"],
      light: "#fff6ef",
      field: function (U, V, Y, h) {
        var r = Math.hypot(U, V);
        if (r < 0.28 && Y < 0.7) return pick(["#efe3cf", "#e6d6bd"], h);
        var d = Math.hypot(U, V, (Y - 0.6) / 0.62);
        if (d < 1.0 && Y >= 0.6) return pick(["#c8242f", "#d8323c", "#b81f2a"], h);
        if (r < 0.95 && Y >= 0.55 && Y < 0.62) return "#f1e2c8";
        return null;
      }
    },

    house: {
      label: "House",
      mode: "tint",
      ground: ["#3e8a45", "#357a3c"],
      dark: ["#3b3f58", "#33374d"],
      light: "#f4efe6",
      field: function (U, V, Y, h) {
        var au = Math.abs(U), av = Math.abs(V);
        if (au < 0.62 && av < 0.75 && Y < 0.7) {
          if (V > 0.72 && au < 0.13 && Y < 0.4) return "#5a3a22";               // door
          if (av > 0.72 && Y > 0.3 && Y < 0.5 && au > 0.25 && au < 0.45) return "#9fd3ff"; // windows
          return pick(["#b5543a", "#a5462e", "#c26147"], h);
        }
        if (Y >= 0.7 && au < 0.75 && av < 0.85 && Y < 0.7 + (0.72 - au) * 0.95) return pick(["#3b3f58", "#454a66", "#33374d"], h);
        if (U > 0.3 && U < 0.48 && V > -0.4 && V < -0.22 && Y < 1.35) return pick(["#7a3b2a", "#6a3222"], h); // chimney
        return null;
      }
    },

    castle: {
      label: "Castle",
      mode: "tint",
      ground: ["#4a4f5a", "#3f444e"],
      dark: ["#555a66", "#4a4f5a"],
      light: "#eceff3",
      field: function (U, V, Y, h) {
        var au = Math.abs(U), av = Math.abs(V);
        var stone = pick(["#555a66", "#626875", "#4a4f5a", "#6b7180"], h);
        var tr = Math.hypot(au - 0.78, av - 0.78);
        if (tr < 0.22) {
          if (Y < 1.1) return stone;
          if (Y < 1.5 && tr < 0.24 - (Y - 1.1) * 0.55) return pick(["#3b4fa0", "#2f4290"], h);
        }
        var wall = (au < 0.82 && av < 0.82) && (au > 0.64 || av > 0.64);
        if (wall && Y < 0.62) return stone;
        if (wall && Y < 0.75 && Math.floor((U + V) * 10) % 2 === 0) return stone;     // crenellations
        if (au < 0.32 && av < 0.32 && Y < 1.35) return stone;                       // keep
        if (au < 0.06 && av < 0.06 && Y >= 1.35 && Y < 1.75) return "#5a3a22";
        if (U > 0.06 && U < 0.3 && av < 0.06 && Y > 1.55 && Y < 1.75) return "#d23b3b"; // flag
        return null;
      }
    },

    rocket: {
      label: "Rocket",
      mode: "tint",
      ground: ["#2b2f6b", "#23275a"],
      dark: ["#3a3f85", "#2b2f6b"],
      light: "#f7f7fb",
      field: function (U, V, Y, h) {
        var r = Math.hypot(U, V);
        if (Y < 0.3) return r < 0.22 - Y * 0.3 ? pick(["#ff8a1f", "#ffb02e", "#ff5a1f"], h) : null;
        if (Y < 1.5 && r < 0.34) {
          if (Y > 0.95 && Y < 1.15 && r > 0.26 && Math.abs(V) > 0.24) return "#5fb4ff"; // window
          return Y < 0.42 ? "#8a8f9c" : pick(["#ffffff", "#f0f1f5"], h);
        }
        if (Y >= 1.5 && r < 0.34 * (1 - (Y - 1.5) / 0.6)) return pick(["#d23b3b", "#c22f2f"], h);
        var fin = (Math.abs(U) < 0.06 || Math.abs(V) < 0.06) && r < 0.72 && Y < 0.9 - r * 0.7;
        if (fin && Y >= 0.3) return pick(["#d23b3b", "#c22f2f"], h);
        return null;
      }
    },

    cactus: {
      label: "Cactus",
      mode: "tint",
      ground: ["#a0612b", "#8c5424"],
      dark: ["#2e7d4f", "#276b43"],
      light: "#fff1b8",
      field: function (U, V, Y, h) {
        var r = Math.hypot(U, V);
        var green = pick(["#2e7d4f", "#3b8f5c", "#276b43"], h);
        if (Y < 0.35) return r < 0.5 - Y * 0.25 ? pick(["#b5652e", "#a35a27", "#c2733a"], h) : null;
        if (r < 0.25 && Y < 1.7) return green;
        if (Math.hypot(U - 0.42, V) < 0.14 && Y > 0.7 && Y < 1.25) return green;
        if (Math.hypot(U + 0.42, V) < 0.14 && Y > 0.9 && Y < 1.45) return green;
        if (Math.abs(V) < 0.14 && Y > 0.62 && Y < 0.8 && U > 0 && U < 0.5) return green;
        if (Math.abs(V) < 0.14 && Y > 0.82 && Y < 1.0 && U < 0 && U > -0.5) return green;
        return null;
      }
    },

    cat: {
      label: "Cat",
      mode: "tint",
      ground: ["#3e8a45", "#357a3c"],
      dark: ["#c2621f", "#a8551b"],
      light: "#fbefe2",
      field: function (U, V, Y, h) {
        var fur = pick(["#d9772b", "#c96a22", "#e08a3c"], h);
        if (Math.hypot(U / 0.55, V / 0.75, (Y - 0.45) / 0.45) < 1) return fur;            // body
        var hy = Y - 1.05, hv = V - 0.35;
        if (Math.hypot(U / 0.42, hv / 0.38, hy / 0.36) < 1) {
          if (hv > 0.28 && hy > 0.02 && hy < 0.12 && Math.abs(Math.abs(U) - 0.16) < 0.06) return "#2b2b2b"; // eyes
          if (hv > 0.33 && Math.abs(U) < 0.06 && hy < 0 && hy > -0.08) return "#f28aa0";    // nose
          return fur;
        }
        var ear = Math.abs(Math.abs(U) - 0.24) < 0.13 - (hy - 0.3) * 0.5 && Math.abs(hv) < 0.08;
        if (ear && hy >= 0.3 && hy < 0.55) return fur;
        if (Math.abs(U - 0.55) < 0.09 && Math.abs(V + 0.55) < 0.09 && Y < 1.0) return fur;  // tail
        return null;
      }
    },

    heart: {
      label: "Heart",
      mode: "tint",
      ground: ["#a3164a", "#8e123f"],
      dark: ["#d81b4a", "#c2153f"],
      light: "#ffe3ea",
      field: function (U, V, Y, h) {
        if (Math.abs(V) > 0.24) return null;
        var x = U * 1.25, y = (Y - 0.95) * 1.25;
        var q = x * x + y * y - 1;
        if (q * q * q - x * x * y * y * y <= 0) return pick(["#d81b4a", "#e83a62", "#c2153f"], h);
        return null;
      }
    },

    planet: {
      label: "Planet",
      mode: "tint",
      ground: ["#3a2a7a", "#2f2266"],
      dark: ["#4b3aa0", "#3a2a7a"],
      light: "#f1ecff",
      field: function (U, V, Y, h) {
        var cy = 1.0, dy = Y - cy;
        var d = Math.hypot(U, V, dy);
        if (d < 0.62) {
          var band = Math.floor((dy + U * 0.25) * 9) % 3;
          return band === 0 ? "#7b5cd6" : band === 1 || band === -1 ? "#9a7cf0" : "#5b40b8";
        }
        // tilted ring
        var ry = dy - U * 0.35;
        var rr = Math.hypot(U, V);
        if (Math.abs(ry) < 0.05 && rr > 0.78 && rr < 1.05) return pick(["#f2b84b", "#e6a63a"], h);
        if (Math.hypot(U + 0.9, V - 0.6, Y - 1.8) < 0.08) return "#ffe28a";                // moon
        return null;
      }
    }
  };

  /* Emoji (or any character) to a standing voxel sprite, a few voxels thick. */
  function emojiModel(ch, R) {
    var px = Math.max(16, Math.round(R * 2));
    var cv = document.createElement("canvas");
    cv.width = cv.height = px;
    var g = cv.getContext("2d");
    g.clearRect(0, 0, px, px);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = Math.round(px * 0.86) + "px \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Noto Color Emoji\", sans-serif";
    g.fillStyle = "#c2153f";
    g.fillText(ch || "🌸", px / 2, px / 2 + px * 0.04);
    var data = g.getImageData(0, 0, px, px).data;
    function hex(r, gg, b) { return "#" + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1); }
    return {
      label: "Emoji",
      mode: "tint",
      ground: ["#3e9b4a", "#2f8a3d"],
      dark: null,           // base dark modules fall back to the emoji's dominant colour
      light: "#fdf6f0",
      field: function (U, V, Y) {
        if (Math.abs(V) > 0.16) return null;
        var x = Math.floor((U + 1) / 2 * px);
        var y = Math.floor((1 - (Y - 0.1) / 2) * px);
        if (x < 0 || y < 0 || x >= px || y >= px) return null;
        var i = (y * px + x) * 4;
        if (data[i + 3] < 120) return null;
        return hex(data[i], data[i + 1], data[i + 2]);
      }
    };
  }

  global.VoxelModels = { MODELS: MODELS, ORDER: Object.keys(MODELS), emoji: emojiModel };
})(window);
