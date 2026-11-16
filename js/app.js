// Token Radar V2 — app shell: hash router, 9 views, settings, toasts, error boundary.
// Live data comes from RadarAPI (DexScreener / GeckoTerminal / GoPlus) with
// source + freshness labels. The v1 pre-token board (window.RADAR, snapshot
// 2026-11-14) is rendered inside Token Explorer, labelled as model data.
(function () {
  'use strict';

  var API = window.RadarAPI;
  var D = window.RadarDiscovery;
  var esc = D.esc;

  var VIEWS = [
    { id: 'overview', label: 'Overview', icon: '◎' },
    { id: 'radar', label: 'Live Radar', icon: '◉' },
    { id: 'new', label: 'New Launches', icon: '✦' },
    { id: 'trending', label: 'Trending', icon: '↗' },
    { id: 'explorer', label: 'Explorer', icon: '⌕' },
    { id: 'analytics', label: 'Analytics', icon: '▦' },
    { id: 'watchlist', label: 'Watchlist', icon: '★' },
    { id: 'risk', label: 'Risk Scanner', icon: '⚠' },
    { id: 'settings', label: 'Settings', icon: '⚙' }
  ];
  var SETTINGS_KEY = 'radarv2.settings.v1';
  var settings = { refresh: 30, chain: 'all', reducedMotion: false };
  try {
    var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s && typeof s === 'object') settings = { refresh: s.refresh || 30, chain: s.chain || 'all', reducedMotion: !!s.reducedMotion };
  } catch (e) {}
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }

  var state = {
    view: 'overview', trending: null, fresh: null, stats: null,
    radarObj: null, radarTokens: [], seenNew: {}, refreshTimer: null, watchTimer: null,
    explorerQuery: '', explorerTokens: null, boardQuery: '', boardTab: 'pre-token'
  };

  // ---------- shell ----------
  var app = document.getElementById('app');
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function freshLine(key) {
    var f = API.fresh(key);
    var s = el('p', 'fresh-line' + (f.stale ? ' stale' : ''));
    s.textContent = f.text;
    return s;
  }
  function errorPanel(host, message, retryFn) {
    host.innerHTML = '';
    var p = el('div', 'panel error-state');
    var h = el('h3', '', 'Could not load this data');
    var m = el('p', '', message);
    var b = el('button', 'button primary', 'Retry');
    b.type = 'button';
    b.addEventListener('click', retryFn);
    p.appendChild(h); p.appendChild(m); p.appendChild(b);
    host.appendChild(p);
  }
  function toast(msg) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = el('div', 'toast', msg);
    box.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 20);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 400); }, 5000);
  }

  function buildShell() {
    app.innerHTML = '';
    var aside = el('aside', 'sidebar');
    var brand = el('div', 'brand');
    brand.innerHTML = '<span class="brand-mark">◉</span><span class="brand-name">Token Radar</span><span class="brand-v">V2</span>';
    aside.appendChild(brand);
    var nav = el('nav', 'side-nav');
    nav.setAttribute('aria-label', 'Sections');
    VIEWS.forEach(function (v) {
      var a = el('a', 'nav-link', v.icon + '  ' + v.label);
      a.href = '#/' + v.id;
      a.setAttribute('data-view', v.id);
      nav.appendChild(a);
    });
    aside.appendChild(nav);
    var sideFoot = el('div', 'side-foot');
    sideFoot.innerHTML = '<span>Live data: DexScreener · GeckoTerminal · GoPlus</span>';
    aside.appendChild(sideFoot);
    var main = el('div', 'main');
    var topbar = el('header', 'topbar');
    topbar.innerHTML = '<span class="topbar-title">Token Radar V2</span><span class="live-dot" title="Live data"></span><span class="topbar-sub">Crypto launch intelligence</span>';
    var view = el('main', 'view');
    view.id = 'view';
    var footer = el('footer', 'app-footer');
    footer.innerHTML = '<span>Data: <a href="https://dexscreener.com" target="_blank" rel="noopener">DexScreener</a> · <a href="https://www.geckoterminal.com" target="_blank" rel="noopener">GeckoTerminal</a> · <a href="https://gopluslabs.io" target="_blank" rel="noopener">GoPlus</a> · Pre-token board: DeFiLlama snapshot 2026-11-14 (model data, not live prices).</span><span>Demo data is always labelled as such. Simulated prices are never shown as real.</span>';
    main.appendChild(topbar);
    main.appendChild(view);
    main.appendChild(footer);
    var bottom = el('nav', 'bottom-nav');
    bottom.setAttribute('aria-label', 'Sections');
    VIEWS.forEach(function (v) {
      var a = el('a', 'bottom-link', v.icon);
      a.href = '#/' + v.id;
      a.setAttribute('data-view', v.id);
      a.title = v.label;
      a.setAttribute('aria-label', v.label);
      bottom.appendChild(a);
    });
    app.appendChild(aside);
    app.appendChild(main);
    app.appendChild(bottom);
    var toasts = el('div', 'toasts');
    toasts.id = 'toasts';
    toasts.setAttribute('aria-live', 'polite');
    app.appendChild(toasts);
    var banner = el('div', 'error-banner hidden');
    banner.id = 'error-banner';
    app.appendChild(banner);
  }
  function setActiveNav() {
    document.querySelectorAll('[data-view]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === state.view);
    });
  }

  // ---------- shared data loaders ----------
  function loadTrending() {
    return API.trending().then(function (res) {
      if (res.ok) { state.trending = res.data; state.radarTokens = res.data; }
      return res;
    });
  }
  function loadFresh() {
    return API.newLaunches().then(function (res) {
      if (res.ok) {
        var fresh = [];
        res.data.forEach(function (t) {
          if (!state.seenNew[t.key]) fresh.push(t);
          state.seenNew[t.key] = true;
        });
        if (fresh.length && state.fresh) {
          fresh.slice(0, 3).forEach(function (t) { toast('New launch detected: ' + t.symbol + ' on ' + t.chainName); });
        }
        state.fresh = res.data;
      }
      return res;
    });
  }
  function chainFiltered(list) {
    if (settings.chain === 'all' || !list) return list || [];
    return list.filter(function (t) { return t.chainId === settings.chain; });
  }
  function openToken(t) { window.RadarIntel.openTokenDetail(t); }
  function onWatch(t, added) { toast(added ? t.symbol + ' added to watchlist' : t.symbol + ' removed from watchlist'); }

  // ---------- views ----------
  function viewOverview(host) {
    host.innerHTML = '';
    var hero = el('section', 'panel hero');
    hero.innerHTML = '<h1>Live token launch intelligence</h1><p>Trending pairs, fresh launches and risk checks — live from DexScreener, GeckoTerminal and GoPlus. The v1 pre-token board (DeFiLlama snapshot 2026-11-14) lives in Explorer.</p>';
    host.appendChild(hero);
    var stats = el('div', 'stat-grid');
    host.appendChild(stats);
    var trendSec = el('section', 'panel');
    trendSec.innerHTML = '<h2>Trending now</h2>';
    var trendList = el('div', 'token-list');
    trendSec.appendChild(trendList);
    trendSec.appendChild(freshLine('trending'));
    host.appendChild(trendSec);
    var newSec = el('section', 'panel');
    newSec.innerHTML = '<h2>Just launched</h2>';
    var newList = el('div', 'token-list');
    newSec.appendChild(newList);
    newSec.appendChild(freshLine('new'));
    host.appendChild(newSec);

    D.skeleton(trendList, 3);
    D.skeleton(newList, 3);
    var statsPromise = Promise.all([loadTrending(), loadFresh()]);
    statsPromise.then(function (parts) {
      var tr = parts[0], nw = parts[1];
      if (tr.ok) {
        var top = chainFiltered(tr.data);
        var vol = top.reduce(function (a, t) { return a + (t.volume24h || 0); }, 0);
        var up = top.filter(function (t) { return (t.chg24h || 0) >= 0; }).length;
        stats.innerHTML = '';
        [['Trending tokens', String(top.length)], ['24h volume (tracked)', D.fmtUsd(vol)], ['Gainers / losers', up + ' / ' + (top.length - up)], ['Chains tracked', '3 networks']]
          .forEach(function (kv) {
            var d = el('div', 'stat');
            d.innerHTML = '<span class="dim">' + esc(kv[0]) + '</span><b>' + esc(kv[1]) + '</b>';
            stats.appendChild(d);
          });
        D.renderList(trendList, top.slice(0, 6), { onOpen: openToken, onWatch: onWatch });
        window.RadarIntel.refreshBadges(top.slice(0, 6));
      } else {
        errorPanel(trendList, tr.error, function () { viewOverview(host); });
      }
      if (nw.ok) {
        D.renderList(newList, chainFiltered(nw.data).slice(0, 6), { onOpen: openToken, onWatch: onWatch });
      } else {
        errorPanel(newList, nw.error, function () { viewOverview(host); });
      }
    });
  }

  function viewRadar(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>Live Radar</h2><p class="dim">Each bubble is a real token from the live trending feed. Size = 24h volume, colour = 24h change, pulsing ring = launched in the last hour. Tap a bubble for its detail. The faint dots are decorative only.</p>';
    var radarHost = el('div', 'radar-host');
    panel.appendChild(radarHost);
    panel.appendChild(freshLine('trending'));
    host.appendChild(panel);
    var listSec = el('section', 'panel');
    listSec.innerHTML = '<h2>On the radar</h2>';
    var list = el('div', 'token-list');
    listSec.appendChild(list);
    host.appendChild(listSec);

    if (state.radarObj) state.radarObj.destroy();
    state.radarObj = window.RadarCanvas.create(radarHost, openToken, { reducedMotion: settings.reducedMotion });
    function fill() {
      var tokens = chainFiltered(state.trending || []);
      state.radarObj.setTokens(tokens);
      D.renderList(list, tokens.slice(0, 12), { onOpen: openToken, onWatch: onWatch });
    }
    if (state.trending) { fill(); return; }
    D.skeleton(list, 6);
    loadTrending().then(function (res) {
      if (!res.ok) { errorPanel(list, res.error, function () { viewRadar(host); }); return; }
      fill();
    });
  }

  function viewNew(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>New Launches</h2><p class="dim">Newest pools first, from GeckoTerminal new pools (Ethereum, Solana, Base). Age is measured from pool creation.</p>';
    var list = el('div', 'token-list');
    panel.appendChild(list);
    panel.appendChild(freshLine('new'));
    host.appendChild(panel);
    D.skeleton(list, 6);
    loadFresh().then(function (res) {
      if (!res.ok) { errorPanel(list, res.error, function () { viewNew(host); }); return; }
      var items = chainFiltered(res.data);
      D.renderList(list, items, { onOpen: openToken, onWatch: onWatch, emptyTitle: 'No new launches', emptyText: 'No new pools were returned for this chain filter.' });
      window.RadarIntel.refreshBadges(items.slice(0, 8));
    });
  }

  function viewTrending(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>Trending Tokens</h2><p class="dim">Trending pools by 24h volume (GeckoTerminal). “Boosted” marks tokens also in DexScreener’s top boosts.</p>';
    var tabs = el('div', 'tabs');
    var sections = [
      { id: 'all', label: 'All trending' },
      { id: 'gainers', label: 'Biggest gainers' },
      { id: 'losers', label: 'Biggest losers' },
      { id: 'volume', label: 'Highest volume' }
    ];
    var current = state.trendingTab || 'all';
    sections.forEach(function (s) {
      var b = el('button', 'tab' + (s.id === current ? ' active' : ''), s.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        current = s.id;
        state.trendingTab = s.id;
        Array.prototype.forEach.call(tabs.children, function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        fill();
      });
      tabs.appendChild(b);
    });
    panel.appendChild(tabs);
    var list = el('div', 'token-list');
    panel.appendChild(list);
    panel.appendChild(freshLine('trending'));
    host.appendChild(panel);
    function fill() {
      var items = chainFiltered(state.trending || []);
      if (current === 'all') { D.renderList(list, items, { onOpen: openToken, onWatch: onWatch }); return; }
      var st = D.splitStats(items);
      D.renderList(list, st[current], { onOpen: openToken, onWatch: onWatch });
      window.RadarIntel.refreshBadges(st[current].slice(0, 8));
    }
    if (state.trending) { fill(); return; }
    D.skeleton(list, 6);
    loadTrending().then(function (res) {
      if (!res.ok) { errorPanel(list, res.error, function () { viewTrending(host); }); return; }
      fill();
    });
  }

  function viewExplorer(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>Token Explorer</h2><p class="dim">Search live pairs on DexScreener by name, symbol or contract address.</p>';
    var bar = el('div', 'search-bar');
    var input = el('input', 'search-input');
    input.type = 'search';
    input.placeholder = 'Search e.g. PEPE, SOL, or a contract address…';
    input.setAttribute('aria-label', 'Search tokens');
    input.value = state.explorerQuery;
    var btn = el('button', 'button primary', 'Search');
    btn.type = 'button';
    bar.appendChild(input);
    bar.appendChild(btn);
    panel.appendChild(bar);
    panel.appendChild(freshLine('search'));
    var list = el('div', 'token-list');
    panel.appendChild(list);
    host.appendChild(panel);
    var deb = null;
    function doSearch(q) {
      state.explorerQuery = q;
      if (!q.trim()) { list.innerHTML = '<p class="dim">Type a name, symbol or address to search live pairs.</p>'; return; }
      D.skeleton(list, 4);
      API.search(q.trim()).then(function (res) {
        if (!res.ok) { errorPanel(list, res.error, function () { doSearch(q); }); return; }
        var items = chainFiltered(res.data);
        D.renderList(list, items.slice(0, 24), { onOpen: openToken, onWatch: onWatch, emptyTitle: 'No pairs found', emptyText: 'DexScreener returned no pairs for this search.' });
        window.RadarIntel.refreshBadges(items.slice(0, 8));
      });
    }
    btn.addEventListener('click', function () { doSearch(input.value); });
    input.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(function () { doSearch(input.value); }, 500);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(input.value); });
    if (state.explorerQuery) doSearch(state.explorerQuery);

    // V1 pre-token board, preserved and labelled as model data.
    var board = el('section', 'panel');
    board.innerHTML = '<h2>Pre-Token Board (V1 model)</h2><p class="dim">Snapshot 2026-11-14 — model data, not live prices. 226 pre-token protocols ranked by implied value (TVL × sector multiple). The model is deterministic and reproducible from the snapshot.</p>';
    var boardBar = el('div', 'search-bar');
    var bq = el('input', 'search-input');
    bq.type = 'search';
    bq.placeholder = 'Search the board…';
    bq.setAttribute('aria-label', 'Search the pre-token board');
    bq.value = state.boardQuery;
    boardBar.appendChild(bq);
    board.appendChild(boardBar);
    var tabs = el('div', 'tabs');
    [['pre-token', 'Pre-token'], ['live', 'Live token']].forEach(function (t) {
      var b = el('button', 'tab' + (state.boardTab === t[0] ? ' active' : ''), t[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        state.boardTab = t[0];
        Array.prototype.forEach.call(tabs.children, function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        renderBoard();
      });
      tabs.appendChild(b);
    });
    board.appendChild(tabs);
    var boardHost = el('div', 'board-host');
    board.appendChild(boardHost);
    var expl = el('details', 'model-explainer');
    var sum = el('summary', '', 'How implied value is computed (model explainer)');
    expl.appendChild(sum);
    board.appendChild(expl);
    host.appendChild(board);

    function renderBoard() {
      var R = window.RADAR;
      if (!R) { boardHost.innerHTML = '<p class="dim">Board data (v2/data.js) failed to load.</p>'; return; }
      var q = state.boardQuery.trim().toLowerCase();
      var rows = state.boardTab === 'pre-token' ? R.rows : R.live;
      var filtered = rows.filter(function (r) {
        if (!q) return true;
        return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
      });
      var html = '<div class="table-wrap"><table class="board-table"><thead><tr><th>Rank</th><th>Protocol</th><th>TVL</th><th>7d</th><th>Age</th><th>Sector ×</th><th>Implied value</th></tr></thead><tbody>';
      filtered.slice(0, 100).forEach(function (r) {
        html += '<tr><td class="num">' + (r.rank || 'live') + '</td><td><b>' + esc(r.name) + '</b><br><span class="dim">' + esc(r.category || 'Other') + ' · ' + esc((r.chains || []).slice(0, 2).join(', ')) + '</span></td>' +
          '<td class="num">' + D.fmtUsd(r.tvl_usd) + '</td>' +
          '<td class="num">' + D.fmtChg(r.change_7d) + '</td>' +
          '<td class="num">' + (r.age_days === null || r.age_days === undefined ? 'Unknown' : r.age_days >= 365 ? (r.age_days / 365).toFixed(1) + 'y' : r.age_days + 'd') + '</td>' +
          '<td class="num">' + (r.category_multiple ? 'x' + r.category_multiple.toFixed(3) : '—') + '</td>' +
          '<td class="num">' + (r.implied_value_usd ? D.fmtUsd(r.implied_value_usd) : (r.mcap_usd ? D.fmtUsd(r.mcap_usd) + ' mcap' : '—')) + '</td></tr>';
      });
      html += '</tbody></table></div><p class="dim">' + filtered.length + ' rows · showing first 100 · snapshot ' + esc(R.as_of) + '</p>';
      boardHost.innerHTML = html;
      var m = R.model;
      var peers = (R.peer_multiples || []).map(function (p) {
        return '<tr><td>' + esc(p.category) + '</td><td class="num">x' + p.multiple.toFixed(3) + '</td><td class="num">' + p.peers + '</td></tr>';
      }).join('');
      expl.querySelectorAll('p, .formula, table').forEach(function (n) { n.remove(); });
      var f = el('p', 'formula', 'implied = round( tvl_usd × sector_multiple × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + ') × (1 + ' + m.chain_bonus + ' × min(chains, ' + m.chain_cap + ')) )');
      var note = el('p', 'dim', 'The sector multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category (≥3 peers, else the global median of x' + R.global_multiple.toFixed(3) + '). Implied value is a model, not a price and not a prediction that a token is issued.');
      var tbl = el('div', 'table-wrap');
      tbl.innerHTML = '<table class="mini"><thead><tr><th>Category</th><th>Multiple</th><th>Live peers</th></tr></thead><tbody>' + peers + '</tbody></table>';
      expl.appendChild(f);
      expl.appendChild(note);
      expl.appendChild(tbl);
    }
    bq.addEventListener('input', function () { state.boardQuery = bq.value; renderBoard(); });
    renderBoard();
  }

  function viewAnalytics(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>Market Analytics</h2><p class="dim">Aggregates computed client-side from the live trending feed — no invented figures.</p>';
    host.appendChild(panel);
    var grid = el('div', 'stat-grid');
    host.appendChild(grid);
    var tableSec = el('section', 'panel');
    tableSec.innerHTML = '<h2>Volume by chain</h2>';
    var tableHost = el('div');
    tableSec.appendChild(tableHost);
    host.appendChild(tableSec);
    function fill() {
      var items = state.trending || [];
      var byChain = {};
      items.forEach(function (t) {
        var c = byChain[t.chainId] || (byChain[t.chainId] = { chain: t.chainName, vol: 0, count: 0, up: 0 });
        c.vol += t.volume24h || 0;
        c.count += 1;
        if ((t.chg24h || 0) >= 0) c.up += 1;
      });
      var chains = Object.keys(byChain).map(function (k) { return byChain[k]; }).sort(function (a, b) { return b.vol - a.vol; });
      grid.innerHTML = '';
      var totalVol = items.reduce(function (a, t) { return a + (t.volume24h || 0); }, 0);
      [['Tokens tracked', String(items.length)], ['Combined 24h volume', D.fmtUsd(totalVol)], ['Chains in feed', String(chains.length)], ['Median 24h change', (function () {
        var ch = items.map(function (t) { return t.chg24h; }).filter(function (v) { return v !== null && v !== undefined; }).sort(function (a, b) { return a - b; });
        return ch.length ? D.fmtChg(ch[Math.floor(ch.length / 2)]) : '—';
      })()]].forEach(function (kv) {
        var d = el('div', 'stat');
        d.innerHTML = '<span class="dim">' + esc(kv[0]) + '</span><b>' + esc(kv[1]) + '</b>';
        grid.appendChild(d);
      });
      var html = '<div class="table-wrap"><table class="mini"><thead><tr><th>Chain</th><th>Tokens</th><th>24h volume</th><th>Gainers</th></tr></thead><tbody>';
      chains.forEach(function (c) {
        html += '<tr><td>' + esc(c.chain) + '</td><td class="num">' + c.count + '</td><td class="num">' + D.fmtUsd(c.vol) + '</td><td class="num">' + c.up + ' / ' + c.count + '</td></tr>';
      });
      html += '</tbody></table></div>';
      tableHost.innerHTML = html || '<p class="dim">No data yet.</p>';
    }
    if (state.trending) { fill(); return; }
    grid.innerHTML = '<div class="stat"><span class="dim">Loading…</span></div>';
    loadTrending().then(function (res) {
      if (!res.ok) { errorPanel(tableHost, res.error, function () { viewAnalytics(host); }); return; }
      fill();
    });
  }

  function viewWatchlist(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>Watchlist</h2><p class="dim">Saved on this device only (localStorage). Prices refresh on the timer you set in Settings.</p>';
    var list = el('div', 'token-list');
    panel.appendChild(list);
    panel.appendChild(freshLine('watchlist'));
    host.appendChild(panel);
    function fill() {
      var items = window.RadarWatchlist.all();
      if (!items.length) {
        list.innerHTML = '<div class="panel empty-state"><h3>Watchlist is empty</h3><p>Add tokens from any card or detail panel with the ☆ Watch button.</p></div>';
        return;
      }
      D.skeleton(list, Math.min(items.length, 4));
      API.refreshPrices(items).then(function (res) {
        var byKey = {};
        if (res.ok) {
          res.data.forEach(function (t) { if (!byKey[t.key] || (t.volume24h || 0) > (byKey[t.key].volume24h || 0)) byKey[t.key] = t; });
        }
        var tokens = items.map(function (it) {
          var live = byKey[it.key];
          if (live) return live;
          return { key: it.key, chainId: it.chainId, address: it.address, pairAddress: it.pairAddress, name: it.name, symbol: it.symbol, icon: it.icon, priceUsd: null, chg24h: null, volume24h: null, liquidityUsd: null, fdv: null, mcap: null, pairCreatedAt: null, txns24h: {}, url: '', source: 'DexScreener' };
        });
        list.innerHTML = '';
        tokens.forEach(function (t) {
          var card = D.tokenCard(t, { onOpen: openToken, onWatch: function () { fill(); } });
          list.appendChild(card);
        });
        if (!res.ok) {
          var warn = el('p', 'fresh-line stale', 'Price refresh failed: ' + res.error + ' — showing saved tokens without live prices.');
          list.appendChild(warn);
        }
      });
    }
    fill();
    if (!state.watchListenerAdded) {
      state.watchListenerAdded = true;
      window.RadarWatchlist.onChange(function () { if (state.view === 'watchlist') fill(); });
    }
  }

  function viewRisk(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>Risk Scanner</h2><p class="dim">Run GoPlus contract checks on any token. A report is a risk assessment, never a safety verdict.</p>';
    var form = el('div', 'risk-form');
    var chainSel = el('select', 'select');
    chainSel.setAttribute('aria-label', 'Chain');
    ['ethereum', 'solana', 'bsc', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'].forEach(function (c) {
      var o = document.createElement('option');
      o.value = c;
      o.textContent = API.chainName(c);
      chainSel.appendChild(o);
    });
    var addr = el('input', 'search-input');
    addr.type = 'text';
    addr.placeholder = 'Contract address, e.g. 0xdac17f958d2ee523a2206206994597c13d831ec7';
    addr.setAttribute('aria-label', 'Contract address');
    var go = el('button', 'button primary', 'Scan');
    go.type = 'button';
    form.appendChild(chainSel);
    form.appendChild(addr);
    form.appendChild(go);
    panel.appendChild(form);
    var out = el('div', 'risk-out');
    panel.appendChild(out);
    host.appendChild(panel);
    function scan() {
      var a = addr.value.trim();
      if (!a) { out.innerHTML = '<p class="dim">Enter a contract address to scan.</p>'; return; }
      window.RadarIntel.renderSecurityReport(out, chainSel.value, a);
    }
    go.addEventListener('click', scan);
    addr.addEventListener('keydown', function (e) { if (e.key === 'Enter') scan(); });
  }

  function viewSettings(host) {
    host.innerHTML = '';
    var panel = el('section', 'panel');
    panel.innerHTML = '<h2>Settings</h2>';
    var form = el('div', 'settings-form');
    function field(label, control) {
      var f = el('label', 'setting-field');
      f.innerHTML = '<span>' + esc(label) + '</span>';
      f.appendChild(control);
      return f;
    }
    var refreshSel = el('select', 'select');
    [[15, 'Every 15 seconds'], [30, 'Every 30 seconds'], [60, 'Every 60 seconds'], [0, 'Off']].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if (settings.refresh === o[0]) opt.selected = true;
      refreshSel.appendChild(opt);
    });
    refreshSel.addEventListener('change', function () { settings.refresh = parseInt(refreshSel.value, 10); saveSettings(); startTimers(); });
    var chainSel = el('select', 'select');
    [['all', 'All chains'], ['ethereum', 'Ethereum'], ['solana', 'Solana'], ['base', 'Base'], ['bsc', 'BNB Chain'], ['polygon', 'Polygon'], ['arbitrum', 'Arbitrum']].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if (settings.chain === o[0]) opt.selected = true;
      chainSel.appendChild(opt);
    });
    chainSel.addEventListener('change', function () { settings.chain = chainSel.value; saveSettings(); render(); });
    var motionChk = el('input', 'checkbox');
    motionChk.type = 'checkbox';
    motionChk.checked = settings.reducedMotion;
    motionChk.addEventListener('change', function () {
      settings.reducedMotion = motionChk.checked;
      saveSettings();
      if (state.radarObj) state.radarObj.setReduced(settings.reducedMotion);
    });
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    form.appendChild(field('Auto-refresh live feeds', refreshSel));
    form.appendChild(field('Chain filter', chainSel));
    form.appendChild(field('Reduced motion (also follows your system setting' + (reduced ? ': currently on' : ': currently off') + ')', motionChk));
    panel.appendChild(form);
    var actions = el('div', 'settings-actions');
    var clearCacheBtn = el('button', 'button', 'Clear cached API data');
    clearCacheBtn.type = 'button';
    clearCacheBtn.addEventListener('click', function () { API.clearCache(); toast('Cached API data cleared'); });
    var clearWatchBtn = el('button', 'button danger', 'Clear watchlist');
    clearWatchBtn.type = 'button';
    clearWatchBtn.addEventListener('click', function () { window.RadarWatchlist.clear(); toast('Watchlist cleared'); });
    actions.appendChild(clearCacheBtn);
    actions.appendChild(clearWatchBtn);
    panel.appendChild(actions);
    var about = el('div', 'panel');
    about.innerHTML = '<h3>About this app</h3><p>Token Radar V2 is a static web app: no build step, no dependencies, no API keys. Live data comes from DexScreener, GeckoTerminal and GoPlus (all free, keyless). Every panel labels its source and freshness; a failed API shows an error state instead of stale data presented as live. The v1 pre-token board is preserved in Explorer as model data from the DeFiLlama snapshot of 2026-11-14.</p>';
    host.appendChild(panel);
    host.appendChild(about);
  }

  var RENDER = {
    overview: viewOverview, radar: viewRadar, new: viewNew, trending: viewTrending,
    explorer: viewExplorer, analytics: viewAnalytics, watchlist: viewWatchlist,
    risk: viewRisk, settings: viewSettings
  };

  // ---------- router + timers ----------
  function route(scroll) {
    var hash = window.location.hash.replace(/^#\/?/, '');
    var id = hash.split('/')[0] || 'overview';
    if (!RENDER[id]) id = 'overview';
    if (id !== 'radar' && state.radarObj) { state.radarObj.destroy(); state.radarObj = null; }
    state.view = id;
    setActiveNav();
    var view = document.getElementById('view');
    if (view) {
      view.innerHTML = '';
      try { RENDER[id](view); } catch (e) {
        errorPanel(view, 'This view failed to render: ' + (e && e.message ? e.message : e), function () { render(); });
      }
      if (scroll !== false) window.scrollTo(0, 0);
    }
  }
  function render(scroll) { route(scroll); }
  function startTimers() {
    if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
    if (!settings.refresh) return;
    state.refreshTimer = setInterval(function () {
      var p = [];
      if (state.view === 'overview' || state.view === 'radar' || state.view === 'trending' || state.view === 'analytics') p.push(loadTrending());
      if (state.view === 'overview' || state.view === 'new') p.push(loadFresh());
      if (state.view === 'watchlist') { render(false); return; }
      Promise.all(p).then(function () {
        if (state.view === 'radar' && state.radarObj) state.radarObj.setTokens(chainFiltered(state.trending || []));
        if (['overview', 'trending', 'analytics', 'new'].indexOf(state.view) >= 0) render(false);
      });
    }, settings.refresh * 1000);
  }

  // ---------- error boundary ----------
  window.addEventListener('error', function (e) {
    var b = document.getElementById('error-banner');
    if (!b) return;
    b.textContent = 'Something went wrong in the app (' + (e && e.message ? e.message : 'unknown error') + ') — the rest of the page keeps running.';
    b.classList.remove('hidden');
    setTimeout(function () { b.classList.add('hidden'); }, 8000);
  });

  buildShell();
  if (settings.reducedMotion === false && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settings.reducedMotion = true;
  }
  window.addEventListener('hashchange', route);
  route();
  startTimers();
})();
