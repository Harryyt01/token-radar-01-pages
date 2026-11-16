// Token Radar V2 — live radar canvas.
// Bubbles are REAL tokens from the live feed (DexScreener / GeckoTerminal):
// bubble size = 24h volume, colour = 24h change, pulsing ring = launched < 1h ago.
// The faint particles are decorative only and are never presented as tokens.
// One requestAnimationFrame loop, no layout work inside the frame.
(function () {
  'use strict';

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function fmtVol(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPrice(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n < 0.000001) return '$' + n.toExponential(2);
    if (n < 1) return '$' + n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    if (n < 1000) return '$' + n.toFixed(2);
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  // Mount a radar in `host`. `onSelect(token)` fires on bubble click/tap.
  // Returns { setTokens, destroy }.
  function createRadar(host, onSelect, opts) {
    opts = opts || {};
    var reduced = opts.reducedMotion || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    host.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'radar-wrap';
    var canvas = document.createElement('canvas');
    canvas.className = 'radar-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Live token radar: each bubble is a real token from the live feed');
    var tip = document.createElement('div');
    tip.className = 'radar-tip hidden';
    var legend = document.createElement('div');
    legend.className = 'radar-legend';
    legend.innerHTML = '<span><i class="dot up"></i>Up 24h</span><span><i class="dot down"></i>Down 24h</span><span><i class="dot new"></i>Launched &lt; 1h</span><span class="dim">Bubble size = 24h volume · particles are decorative</span>';
    wrap.appendChild(canvas);
    wrap.appendChild(tip);
    wrap.appendChild(legend);
    host.appendChild(wrap);

    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0;
    var tokens = []; // {t, angle, radius, speed, r, isNew, x, y}
    var particles = [];
    var sweep = 0, last = 0, raf = 0, running = false;
    var hovered = null, selectedKey = null;

    function resize() {
      var rect = wrap.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = Math.max(260, Math.floor(rect.width));
      H = Math.max(300, Math.floor(W * 0.72));
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2;
      R = Math.min(W, H) / 2 - 14;
      layoutTokens();
      draw(0);
    }
    function seedParticles() {
      particles = [];
      for (var i = 0; i < 42; i++) {
        particles.push({ a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()) * R, s: 0.02 + Math.random() * 0.05, size: 0.6 + Math.random() * 1.4 });
      }
    }
    function setTokens(list) {
      var now = Date.now();
      tokens = (list || []).slice(0, 40).map(function (t) {
        var h1 = hashStr(t.key + ':a'), h2 = hashStr(t.key + ':r'), h3 = hashStr(t.key + ':s');
        var vol = t.volume24h || 0;
        var r = 9 + Math.min(26, Math.log10(vol + 10) * 6);
        return {
          t: t,
          angle: h1 * Math.PI * 2,
          radius: 0.22 + h2 * 0.72,
          speed: (0.02 + h3 * 0.05) * (h3 > 0.5 ? 1 : -1),
          r: r,
          isNew: !!(t.pairCreatedAt && now - t.pairCreatedAt < 3600000),
          x: 0, y: 0
        };
      });
      layoutTokens();
      draw(0);
    }
    function layoutTokens() {
      tokens.forEach(function (b) {
        b.x = cx + Math.cos(b.angle) * b.radius * R;
        b.y = cy + Math.sin(b.angle) * b.radius * R;
      });
    }
    function draw(dt) {
      ctx.clearRect(0, 0, W, H);
      if (!reduced) sweep = (sweep + dt * 0.00045) % (Math.PI * 2);
      // rings
      ctx.strokeStyle = 'rgba(125,211,252,0.12)';
      ctx.lineWidth = 1;
      [0.33, 0.66, 1].forEach(function (f) {
        ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke();
      });
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      // sweep beam
      if (!reduced) {
        var grad = ctx.createConicGradient ? ctx.createConicGradient(sweep, cx, cy) : null;
        if (grad) {
          grad.addColorStop(0, 'rgba(125,211,252,0.20)');
          grad.addColorStop(0.12, 'rgba(125,211,252,0.05)');
          grad.addColorStop(0.25, 'rgba(125,211,252,0)');
          grad.addColorStop(1, 'rgba(125,211,252,0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, sweep - 0.9, sweep); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(125,211,252,0.55)';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
      }
      // decorative particles (never tokens)
      if (!reduced) {
        ctx.fillStyle = 'rgba(148,163,184,0.35)';
        particles.forEach(function (p) {
          p.a += p.s * dt * 0.001;
          var px = cx + Math.cos(p.a) * p.r * R, py = cy + Math.sin(p.a) * p.r * R;
          ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI * 2); ctx.fill();
        });
      }
      // connecting lines to 3 nearest neighbours
      ctx.strokeStyle = 'rgba(125,211,252,0.10)';
      for (var i = 0; i < tokens.length; i++) {
        var a = tokens[i];
        var near = tokens.map(function (b) {
          return { b: b, d: (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) };
        }).filter(function (o) { return o.b !== a; }).sort(function (p, q) { return p.d - q.d; }).slice(0, 3);
        near.forEach(function (o) {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(o.b.x, o.b.y); ctx.stroke();
        });
      }
      // bubbles
      var now = Date.now();
      tokens.forEach(function (b) {
        var up = (b.t.chg24h === null || b.t.chg24h === undefined) ? null : b.t.chg24h >= 0;
        var col = up === null ? '#94a3b8' : up ? '#34d399' : '#f87171';
        if (b.isNew && !reduced) {
          var ph = (now % 1600) / 1600;
          ctx.strokeStyle = 'rgba(251,191,36,' + (0.7 * (1 - ph)) + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4 + ph * 14, 0, Math.PI * 2); ctx.stroke();
        }
        var g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r);
        g.addColorStop(0, 'rgba(255,255,255,0.28)');
        g.addColorStop(0.45, col + '55');
        g.addColorStop(1, col + '22');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = b.t.key === selectedKey ? 2.5 : 1.2;
        ctx.stroke();
      });
      // Labels: only the 12 largest bubbles get a label at all (dense clusters
      // stay readable — the rest are still hoverable/clickable for their name),
      // largest first, skipping any label whose box would overlap one already
      // drawn, with a dark halo.
      var drawn = [];
      tokens.slice().sort(function (a, b) { return b.r - a.r; }).slice(0, 12).forEach(function (b) {
        var size = Math.max(9, Math.min(12, b.r * 0.55));
        ctx.font = '600 ' + size + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        var label = b.t.symbol.length > 6 ? b.t.symbol.slice(0, 6) : b.t.symbol;
        var w = ctx.measureText(label).width;
        var box = { x: b.x - w / 2 - 3, y: b.y - size * 0.7, w: w + 6, h: size * 1.4 };
        for (var i = 0; i < drawn.length; i++) {
          var o = drawn[i];
          if (box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y) return;
        }
        drawn.push(box);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(2,6,16,0.75)';
        ctx.strokeText(label, b.x, b.y);
        ctx.fillStyle = '#eef2f7';
        ctx.fillText(label, b.x, b.y);
      });
      // center hub
      ctx.fillStyle = 'rgba(15,23,42,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(125,211,252,0.7)';
      ctx.stroke();
    }
    function frame(ts) {
      if (!running) return;
      var dt = Math.min(50, ts - (last || ts));
      last = ts;
      if (!reduced) {
        tokens.forEach(function (b) { b.angle += b.speed * dt * 0.001; });
        layoutTokens();
      }
      draw(dt);
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

    function pick(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var mx = clientX - rect.left, my = clientY - rect.top;
      var best = null, bestD = Infinity;
      tokens.forEach(function (b) {
        var d = (mx - b.x) * (mx - b.x) + (my - b.y) * (my - b.y);
        var rr = Math.max(b.r + 6, 14);
        if (d < rr * rr && d < bestD) { best = b; bestD = d; }
      });
      return best;
    }
    function showTip(b, clientX, clientY) {
      if (!b) { tip.classList.add('hidden'); hovered = null; return; }
      hovered = b;
      var t = b.t;
      var chg = t.chg24h === null || t.chg24h === undefined ? '—' : (t.chg24h >= 0 ? '+' : '') + t.chg24h.toFixed(2) + '%';
      tip.innerHTML = '<b>' + escapeHtml(t.name) + ' (' + escapeHtml(t.symbol) + ')</b>' +
        '<span>Price ' + fmtPrice(t.priceUsd) + ' · 24h ' + chg + '</span>' +
        '<span>Vol 24h ' + fmtVol(t.volume24h) + ' · Liq ' + fmtVol(t.liquidityUsd) + '</span>' +
        '<span>' + escapeHtml(t.chainName) + ' · tap for details</span>';
      tip.classList.remove('hidden');
      var rect = wrap.getBoundingClientRect();
      var x = Math.min(Math.max(8, clientX - rect.left + 14), rect.width - 210);
      var y = Math.max(8, clientY - rect.top - 10);
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }
    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    canvas.addEventListener('mousemove', function (e) { showTip(pick(e.clientX, e.clientY), e.clientX, e.clientY); });
    canvas.addEventListener('mouseleave', function () { showTip(null); });
    canvas.addEventListener('click', function (e) {
      var b = pick(e.clientX, e.clientY);
      if (b) { selectedKey = b.t.key; if (typeof onSelect === 'function') onSelect(b.t); draw(0); }
    });
    canvas.addEventListener('touchstart', function (e) {
      if (!e.touches.length) return;
      var b = pick(e.touches[0].clientX, e.touches[0].clientY);
      if (b) { selectedKey = b.t.key; showTip(b, e.touches[0].clientX, e.touches[0].clientY); if (typeof onSelect === 'function') onSelect(b.t); }
    }, { passive: true });

    var ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(wrap); }
    window.addEventListener('resize', resize);
    seedParticles();
    resize();
    start();

    return {
      setTokens: setTokens,
      setReduced: function (v) { reduced = !!v; if (reduced) { stop(); draw(0); } else { start(); } },
      destroy: function () { stop(); if (ro) ro.disconnect(); window.removeEventListener('resize', resize); }
    };
  }

  window.RadarCanvas = { create: createRadar, fmtPrice: fmtPrice, fmtVol: fmtVol };
})();
