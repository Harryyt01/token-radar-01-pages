// Token Radar V2 — canvas price chart.
// Candles + volume bars from GeckoTerminal OHLCV, line-mode toggle, timeframes
// 1m/5m/15m/1h/4h/24h, crosshair + tooltip. Refreshes append/merge new candles
// instead of rebuilding the chart. No data is invented: an empty OHLCV list
// renders an explicit "no chart data" state.
(function () {
  'use strict';

  var TFs = ['1m', '5m', '15m', '1h', '4h', '24h'];
  var UP = '#34d399', DOWN = '#f87171', GRID = 'rgba(255,255,255,0.07)', TEXT = 'rgba(235,238,245,0.55)';

  function fmtPrice(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n === 0) return '$0';
    if (n < 0.000001) return '$' + n.toExponential(2);
    if (n < 1) return '$' + n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    if (n < 1000) return '$' + n.toFixed(2);
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function fmtVol(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtTime(t) {
    var d = new Date(t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Create a chart inside `host` for `token` (a normalized token object).
  // Returns { setToken, setTimeframe, setMode, refresh, destroy }.
  function createChart(host, token, opts) {
    opts = opts || {};
    var state = { token: token, tf: opts.tf || '1h', mode: opts.mode || 'candles', candles: [], loading: false, error: null, hover: -1, stale: false };
    var timer = null;

    host.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    var head = document.createElement('div');
    head.className = 'chart-head';
    var tfRow = document.createElement('div');
    tfRow.className = 'tf-row';
    TFs.forEach(function (tf) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tf-btn' + (tf === state.tf ? ' active' : '');
      b.textContent = tf;
      b.setAttribute('aria-pressed', tf === state.tf ? 'true' : 'false');
      b.addEventListener('click', function () { api.setTimeframe(tf); });
      tfRow.appendChild(b);
    });
    var modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'mode-btn';
    modeBtn.textContent = state.mode === 'candles' ? 'Candles' : 'Line';
    modeBtn.addEventListener('click', function () {
      state.mode = state.mode === 'candles' ? 'line' : 'candles';
      modeBtn.textContent = state.mode === 'candles' ? 'Candles' : 'Line';
      draw();
    });
    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'mode-btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('click', function () { api.refresh(true); });
    head.appendChild(tfRow);
    var headRight = document.createElement('div');
    headRight.className = 'chart-head-right';
    headRight.appendChild(modeBtn);
    headRight.appendChild(refreshBtn);
    head.appendChild(headRight);
    var status = document.createElement('div');
    status.className = 'chart-status';
    var canvas = document.createElement('canvas');
    canvas.className = 'chart-canvas';
    canvas.setAttribute('aria-label', 'Price chart');
    var tip = document.createElement('div');
    tip.className = 'chart-tip hidden';
    wrap.appendChild(head);
    wrap.appendChild(status);
    wrap.appendChild(canvas);
    wrap.appendChild(tip);
    host.appendChild(wrap);

    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = 1;

    function resize() {
      var rect = wrap.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = Math.max(200, Math.floor(rect.width));
      H = 300;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    function setStatus(msg, isError) {
      status.textContent = msg || '';
      status.classList.toggle('error', !!isError);
      status.classList.toggle('hidden', !msg);
    }
    function mergeCandles(list) {
      // Append/merge by timestamp; never rebuild from scratch on refresh.
      var byT = {};
      state.candles.forEach(function (c) { byT[c.t] = c; });
      list.forEach(function (c) { byT[c.t] = c; });
      state.candles = Object.keys(byT).map(function (k) { return byT[k]; })
        .sort(function (a, b) { return a.t - b.t; })
        .slice(-200);
    }
    function load(force) {
      if (!state.token || !state.token.pairAddress) {
        state.candles = [];
        state.error = 'No chart pool for this token.';
        setStatus('No chart data — no pool found for this token.', true);
        draw();
        return Promise.resolve();
      }
      if (state.loading) return Promise.resolve();
      state.loading = true;
      if (!state.candles.length || force) setStatus('Loading chart… GeckoTerminal');
      return window.RadarAPI.ohlcv(state.token.chainId, state.token.pairAddress, state.tf)
        .then(function (res) {
          state.loading = false;
          if (!res.ok) {
            state.error = res.error;
            setStatus('Chart unavailable: ' + res.error + ' — retry from the Refresh button.', true);
            draw();
            return;
          }
          state.error = null;
          mergeCandles(res.data);
          if (!state.candles.length) {
            setStatus('No chart data — GeckoTerminal has no candles for this pool and timeframe.', true);
          } else {
            var f = window.RadarAPI.fresh('ohlcv');
            setStatus('GeckoTerminal · updated ' + (f.at ? Math.max(0, Math.round((Date.now() - f.at) / 1000)) + 's ago' : 'just now') + (state.candles.length ? ' · ' + state.candles.length + ' candles' : ''));
          }
          draw();
        });
    }
    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      var padL = 8, padR = 64, padT = 12, padB = 22;
      var iw = W - padL - padR, ih = H - padT - padB;
      if (!state.candles.length) {
        ctx.fillStyle = TEXT;
        ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(state.loading ? 'Loading chart…' : 'No chart data', padL + iw / 2, padT + ih / 2);
        return;
      }
      var cs = state.candles;
      var lo = Infinity, hi = -Infinity, vmax = 0;
      cs.forEach(function (c) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; if (c.v > vmax) vmax = c.v; });
      if (hi <= lo) { hi = lo * 1.01 + 1e-12; }
      var pad = (hi - lo) * 0.08;
      lo -= pad; hi += pad;
      var x = function (i) { return padL + (i / Math.max(1, cs.length - 1)) * iw; };
      var y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * ih * 0.82; };
      var volH = ih * 0.16;
      // grid + price labels
      ctx.strokeStyle = GRID;
      ctx.fillStyle = TEXT;
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      for (var g = 0; g <= 4; g++) {
        var gy = padT + (g / 4) * ih * 0.82;
        ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + iw, gy); ctx.stroke();
        ctx.fillText(fmtPrice(hi - (g / 4) * (hi - lo)), padL + iw + 6, gy + 4);
      }
      // volume bars
      cs.forEach(function (c, i) {
        var h = vmax > 0 ? (c.v / vmax) * volH : 0;
        ctx.fillStyle = c.c >= c.o ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)';
        ctx.fillRect(x(i) - Math.max(1, iw / cs.length / 2 - 0.5), padT + ih - h, Math.max(1, iw / cs.length - 1), h);
      });
      if (state.mode === 'candles') {
        var bw = Math.max(2, Math.min(14, iw / cs.length * 0.6));
        cs.forEach(function (c, i) {
          var up = c.c >= c.o;
          ctx.strokeStyle = up ? UP : DOWN;
          ctx.fillStyle = up ? UP : DOWN;
          ctx.beginPath(); ctx.moveTo(x(i), y(c.h)); ctx.lineTo(x(i), y(c.l)); ctx.stroke();
          var top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
          ctx.fillRect(x(i) - bw / 2, top, bw, Math.max(1, bot - top));
        });
      } else {
        ctx.beginPath();
        cs.forEach(function (c, i) { if (i === 0) ctx.moveTo(x(i), y(c.c)); else ctx.lineTo(x(i), y(c.c)); });
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineTo(x(cs.length - 1), padT + ih * 0.82);
        ctx.lineTo(x(0), padT + ih * 0.82);
        ctx.closePath();
        var grad = ctx.createLinearGradient(0, padT, 0, padT + ih * 0.82);
        grad.addColorStop(0, 'rgba(125,211,252,0.25)');
        grad.addColorStop(1, 'rgba(125,211,252,0)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 1;
      }
      // crosshair
      if (state.hover >= 0 && state.hover < cs.length) {
        var c = cs[state.hover];
        var cx = x(state.hover);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + ih); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(padL, y(c.c)); ctx.lineTo(padL + iw, y(c.c)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e8ecf3';
        ctx.beginPath(); ctx.arc(cx, y(c.c), 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    function hoverAt(clientX) {
      var rect = canvas.getBoundingClientRect();
      var padL = 8, padR = 64;
      var iw = rect.width - padL - padR;
      if (!state.candles.length) return;
      var rel = (clientX - rect.left - padL) / iw;
      var idx = Math.round(rel * (state.candles.length - 1));
      if (idx < 0 || idx >= state.candles.length) { state.hover = -1; tip.classList.add('hidden'); draw(); return; }
      state.hover = idx;
      var c = state.candles[idx];
      tip.innerHTML = '';
      tip.innerHTML = '<b>' + fmtPrice(c.c) + '</b><span>O ' + fmtPrice(c.o) + ' · H ' + fmtPrice(c.h) + ' · L ' + fmtPrice(c.l) + '</span><span>Vol ' + fmtVol(c.v) + ' · ' + fmtTime(c.t) + '</span>';
      tip.classList.remove('hidden');
      draw();
    }
    canvas.addEventListener('mousemove', function (e) { hoverAt(e.clientX); });
    canvas.addEventListener('mouseleave', function () { state.hover = -1; tip.classList.add('hidden'); draw(); });
    canvas.addEventListener('touchmove', function (e) { if (e.touches.length) hoverAt(e.touches[0].clientX); }, { passive: true });

    var ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(wrap); }
    window.addEventListener('resize', resize);
    resize();

    var api = {
      setToken: function (t) { state.token = t; state.candles = []; state.hover = -1; load(true); },
      setTimeframe: function (tf) {
        if (TFs.indexOf(tf) < 0) return;
        state.tf = tf;
        Array.prototype.forEach.call(tfRow.children, function (b) {
          var on = b.textContent === tf;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        state.candles = [];
        load(true);
      },
      refresh: function (force) { load(!!force); },
      destroy: function () {
        if (ro) ro.disconnect();
        window.removeEventListener('resize', resize);
        if (timer) clearInterval(timer);
      }
    };
    if (token) load(false);
    return api;
  }

  window.RadarChart = { create: createChart, fmtPrice: fmtPrice, fmtVol: fmtVol, fmtTime: fmtTime, timeframes: TFs };
})();
