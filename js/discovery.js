// Token Radar V2 — token discovery: cards + lists.
// Cards show only what the source APIs returned; a missing field renders as
// "—" or "Unavailable", never an invented value. Risk badges come from GoPlus
// when loaded, otherwise the card says "not checked".
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPrice(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n === 0) return '$0';
    if (n < 0.000001) return '$' + n.toExponential(2);
    if (n < 1) return '$' + n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    if (n < 1000) return '$' + n.toFixed(2);
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  function fmtChg(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(ms) {
    if (!ms) return 'Unknown';
    var age = Date.now() - ms;
    if (age < 0) return 'just now';
    if (age < 3600000) return Math.floor(age / 60000) + 'm';
    if (age < 86400000) return Math.floor(age / 3600000) + 'h';
    if (age < 86400000 * 365) return Math.floor(age / 86400000) + 'd';
    return (age / (86400000 * 365)).toFixed(1) + 'y';
  }
  function shortAddr(a) {
    if (!a) return '—';
    return a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a;
  }

  // One token card. onOpen(token) opens the detail panel; onWatch(token, added)
  // fires after a watchlist toggle.
  function tokenCard(t, opts) {
    opts = opts || {};
    var card = document.createElement('article');
    card.className = 'token-card';
    card.setAttribute('data-key', t.key);
    var watched = window.RadarWatchlist ? window.RadarWatchlist.has(t) : false;
    var logo = document.createElement('div');
    logo.className = 'token-logo';
    if (t.icon) {
      var img = document.createElement('img');
      img.src = t.icon;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = function () { img.remove(); logo.textContent = (t.symbol || '?').slice(0, 2).toUpperCase(); };
      logo.appendChild(img);
    } else {
      logo.textContent = (t.symbol || '?').slice(0, 2).toUpperCase();
    }
    var head = document.createElement('div');
    head.className = 'token-head';
    head.appendChild(logo);
    var names = document.createElement('div');
    names.className = 'token-names';
    var nm = document.createElement('b');
    nm.textContent = t.name;
    var sym = document.createElement('span');
    sym.className = 'dim';
    sym.textContent = t.symbol + ' · ' + t.chainName;
    names.appendChild(nm);
    names.appendChild(sym);
    head.appendChild(names);
    if (t.boosted) {
      var boost = document.createElement('span');
      boost.className = 'pill boost';
      boost.textContent = 'Boosted';
      head.appendChild(boost);
    }
    var watchBtn = document.createElement('button');
    watchBtn.type = 'button';
    watchBtn.className = 'watch-btn' + (watched ? ' on' : '');
    watchBtn.textContent = watched ? '★ Watching' : '☆ Watch';
    watchBtn.setAttribute('aria-pressed', watched ? 'true' : 'false');
    watchBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var added = window.RadarWatchlist.toggle(t);
      watchBtn.classList.toggle('on', added);
      watchBtn.textContent = added ? '★ Watching' : '☆ Watch';
      watchBtn.setAttribute('aria-pressed', added ? 'true' : 'false');
      if (typeof opts.onWatch === 'function') opts.onWatch(t, added);
    });
    head.appendChild(watchBtn);
    card.appendChild(head);

    var price = document.createElement('div');
    price.className = 'token-price';
    var pv = document.createElement('b');
    pv.textContent = fmtPrice(t.priceUsd);
    var chg = document.createElement('span');
    chg.className = 'chg ' + (t.chg24h === null || t.chg24h === undefined ? '' : t.chg24h >= 0 ? 'pos' : 'neg');
    chg.textContent = fmtChg(t.chg24h) + ' 24h';
    price.appendChild(pv);
    price.appendChild(chg);
    card.appendChild(price);

    var grid = document.createElement('div');
    grid.className = 'token-grid';
    var rows = [
      ['Market cap', fmtUsd(t.mcap !== null && t.mcap !== undefined ? t.mcap : t.fdv)],
      ['Liquidity', fmtUsd(t.liquidityUsd)],
      ['24h volume', fmtUsd(t.volume24h)],
      ['Age', fmtAge(t.pairCreatedAt)]
    ];
    rows.forEach(function (r) {
      var d = document.createElement('div');
      var k = document.createElement('span');
      k.className = 'dim';
      k.textContent = r[0];
      var v = document.createElement('b');
      v.textContent = r[1];
      d.appendChild(k);
      d.appendChild(v);
      grid.appendChild(d);
    });
    card.appendChild(grid);

    var foot = document.createElement('div');
    foot.className = 'token-foot';
    var addr = document.createElement('button');
    addr.type = 'button';
    addr.className = 'addr';
    addr.textContent = shortAddr(t.address);
    addr.title = 'Copy contract address';
    addr.addEventListener('click', function (e) {
      e.stopPropagation();
      var done = function () { addr.textContent = 'Copied ✓'; setTimeout(function () { addr.textContent = shortAddr(t.address); }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.address).then(done, done);
      else done();
    });
    foot.appendChild(addr);
    var risk = document.createElement('span');
    risk.className = 'risk-badge';
    risk.textContent = 'Risk: not checked';
    risk.setAttribute('data-risk-for', t.key);
    foot.appendChild(risk);
    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'open-btn';
    open.textContent = 'Details →';
    open.addEventListener('click', function () { if (typeof opts.onOpen === 'function') opts.onOpen(t); });
    foot.appendChild(open);
    card.appendChild(foot);

    card.addEventListener('click', function () { if (typeof opts.onOpen === 'function') opts.onOpen(t); });
    return card;
  }

  // Render a list of tokens into `host` with a loading skeleton first.
  function renderList(host, tokens, opts) {
    opts = opts || {};
    host.innerHTML = '';
    if (!tokens || !tokens.length) {
      var empty = document.createElement('div');
      empty.className = 'panel empty-state';
      empty.innerHTML = '<h3>' + esc(opts.emptyTitle || 'Nothing here yet') + '</h3><p>' + esc(opts.emptyText || 'No tokens matched. Try refreshing or changing the filter.') + '</p>';
      host.appendChild(empty);
      return;
    }
    tokens.forEach(function (t) { host.appendChild(tokenCard(t, opts)); });
  }
  function skeleton(host, n) {
    host.innerHTML = '';
    for (var i = 0; i < (n || 6); i++) {
      var s = document.createElement('div');
      s.className = 'token-card skeleton';
      s.innerHTML = '<div class="sk sk-logo"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div><div class="sk sk-grid"></div>';
      host.appendChild(s);
    }
  }
  // Split a token list into gainers / losers / highest volume (client-side).
  function splitStats(tokens) {
    var withChg = tokens.filter(function (t) { return t.chg24h !== null && t.chg24h !== undefined; });
    var gainers = withChg.slice().sort(function (a, b) { return b.chg24h - a.chg24h; }).slice(0, 10);
    var losers = withChg.slice().sort(function (a, b) { return a.chg24h - b.chg24h; }).slice(0, 10);
    var volume = tokens.slice().sort(function (a, b) { return (b.volume24h || 0) - (a.volume24h || 0); }).slice(0, 10);
    return { gainers: gainers, losers: losers, volume: volume };
  }

  window.RadarDiscovery = {
    tokenCard: tokenCard, renderList: renderList, skeleton: skeleton, splitStats: splitStats,
    fmtUsd: fmtUsd, fmtPrice: fmtPrice, fmtChg: fmtChg, fmtAge: fmtAge, shortAddr: shortAddr, esc: esc
  };
})();
