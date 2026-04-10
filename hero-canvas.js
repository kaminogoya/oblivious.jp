(function () {
  var canvas = document.querySelector(".page-canvas");
  if (!canvas) return;

  var context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  var width = 0;
  var height = 0;
  var rafId = null;
  var lastFrame = 0;
  var frameInterval = 1000 / 12;
  var particles = [];

  var fields = [
    { x: 0.18, y: 0.14, rx: 0.24, ry: 0.16, strength: 0.68, drift: 0.012, phase: 0.3 },
    { x: 0.38, y: 0.44, rx: 0.34, ry: 0.2, strength: 1.08, drift: 0.009, phase: 1.2 },
    { x: 0.7, y: 0.34, rx: 0.28, ry: 0.16, strength: 0.88, drift: 0.01, phase: 2.4 },
    { x: 0.64, y: 0.78, rx: 0.32, ry: 0.2, strength: 0.96, drift: 0.008, phase: 3.7 }
  ];

  function hash(x, y) {
    var value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function smoothstep(edge0, edge1, value) {
    var t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
  }

  function valueNoise(x, y) {
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var x1 = x0 + 1;
    var y1 = y0 + 1;
    var sx = smoothstep(0, 1, x - x0);
    var sy = smoothstep(0, 1, y - y0);

    var n00 = hash(x0, y0);
    var n10 = hash(x1, y0);
    var n01 = hash(x0, y1);
    var n11 = hash(x1, y1);

    var ix0 = n00 + (n10 - n00) * sx;
    var ix1 = n01 + (n11 - n01) * sx;
    return ix0 + (ix1 - ix0) * sy;
  }

  function fbm(x, y, octaves) {
    var value = 0;
    var amplitude = 0.5;
    var frequency = 1;
    var normalization = 0;

    for (var i = 0; i < octaves; i += 1) {
      value += valueNoise(x * frequency, y * frequency) * amplitude;
      normalization += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    return normalization ? value / normalization : 0;
  }

  function densityAt(nx, ny, time) {
    var value = 0;

    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      var cx = field.x + Math.sin(time * field.drift * 3.2 + field.phase) * 0.11;
      var cy = field.y + Math.cos(time * field.drift * 2.8 + field.phase) * 0.09;
      var dx = (nx - cx) / field.rx;
      var dy = (ny - cy) / field.ry;
      value += Math.exp(-(dx * dx + dy * dy) * 1.7) * field.strength;
    }

    value += fbm(nx * 2 + time * 0.18, ny * 1.9 - time * 0.13, 4) * 0.34;
    value += fbm(nx * 5.4 - time * 0.22, ny * 5 + time * 0.16, 3) * 0.06;

    var waveA = Math.sin((nx * 2.8 + ny * 8.6) + time * 1.55) * 0.18;
    var waveB = Math.sin((nx * 1.6 + ny * 5.2) + time * 1.05 + 0.8) * 0.1;
    var waveC = Math.sin((nx * 4.2 - ny * 2.4) + time * 0.74 + 1.7) * 0.05;
    value += waveA + waveB + waveC;

    var fadeLeft = smoothstep(-0.08, 0.2, nx);
    var fadeTop = smoothstep(-0.08, 0.16, ny);
    var fadeBottom = 1 - smoothstep(0.88, 1.08, ny);

    return Math.pow(Math.max(value, 0), 1.72) * fadeLeft * fadeTop * fadeBottom;
  }

  function buildParticles() {
    particles = [];
    var spacing = width < 700 ? 3 : 3;

    for (var y = 0; y < height; y += spacing) {
      for (var x = 0; x < width; x += spacing) {
        particles.push({
          x: x,
          y: y,
          nx: x / width,
          ny: y / height,
          seed: hash(x * 0.31, y * 0.29),
          jitterX: (hash(x * 0.11, y * 0.07) - 0.5) * spacing * 0.8,
          jitterY: (hash(x * 0.19, y * 0.23) - 0.5) * spacing * 0.8,
          radius: (width < 700 ? 0.5 : 0.58) + hash(x * 0.07, y * 0.05) * 0.22
        });
      }
    }
  }

  function resize() {
    width = Math.max(1, Math.round(window.innerWidth));
    height = Math.max(1, Math.round(window.innerHeight));

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    buildParticles();
    draw(performance.now());
  }

  function draw(timeMs) {
    context.clearRect(0, 0, width, height);

    var time = timeMs * 0.001;

    for (var i = 0; i < particles.length; i += 1) {
      var particle = particles[i];
      var density = densityAt(particle.nx, particle.ny, time);

      if (density < 0.01) continue;

      var shimmer = Math.sin(time * 2.8 + particle.nx * 2.2 + particle.ny * 6.4) * 0.05;
      var threshold = 0.16 + density * 1.16 + shimmer;
      if (particle.seed > threshold) continue;

      var alpha = Math.min(0.19, 0.012 + density * 0.145);

      context.beginPath();
      context.fillStyle = "rgba(134, 126, 118, " + alpha.toFixed(4) + ")";
      context.arc(particle.x + particle.jitterX, particle.y + particle.jitterY, particle.radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  function frame(now) {
    if (!prefersReducedMotion.matches && now - lastFrame >= frameInterval) {
      lastFrame = now;
      draw(now);
    }

    if (!prefersReducedMotion.matches) {
      rafId = window.requestAnimationFrame(frame);
    }
  }

  function start() {
    if (rafId) window.cancelAnimationFrame(rafId);
    lastFrame = 0;

    if (prefersReducedMotion.matches) {
      draw(performance.now());
      return;
    }

    rafId = window.requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  prefersReducedMotion.addEventListener("change", start);

  resize();
  start();
})();
