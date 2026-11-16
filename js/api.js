// Token Radar V2 — API layer only.
// Free, keyless public APIs: DexScreener, GeckoTerminal, GoPlus.
// Every function returns { ok, data, error, source, at } so panels can render
// a real error state with retry instead of pretending stale data is live.
// No API keys anywhere. All requests are client-side fetch with timeout,
// response validation, caching (memory + localStorage with TTLs) and a
// GeckoTerminal request queue (max ~1 request per 2s) with 429 backoff.
(function () {
  'use strict';

  var DEX = 'https://api.dexscreener.com';
  var GT = 'https://api.geckoterminal.com/api/v2';
  var GOPLUS = 'https://api.gopluslabs.io/api/v1';
  var TIMEOUT_MS = 12000;
  var GT_GAP_MS = 2000; // GeckoTerminal free tier: 30 requests/minute
  var LS_KEY = 'radarv2.cache.v1';
  var LS_MAX_BYTES = 180000;

  var TTL = { search: 30000, trending: 60000, fresh: 60000, pairs: 30000, ohlcv: 60000, security: 600000, boosts: 120000 };

  // Chain display names for DexScreener chainId values.
  var CHAIN_NAMES = {
    ethereum: 'Ethereum', solana: 'Solana', bsc: 'BNB Chain', base: 'Base',
    polygon: 'Polygon', arbitrum: 'Arbitrum', optimism: 'Optimism', avalanche: 'Avalanche',
    fantom: 'Fantom', linea: 'Linea', cronos: 'Cronos', zksync: 'zkSync', blast: 'Blast',
    scroll: 'Scroll', mantle: 'Mantle', apechain: 'ApeChain', sonic: 'Sonic', berachain: 'Berachain'
  };
  // DexScreener chainId -> GeckoTerminal network id.
  var GT_NETWORK = {
    ethereum: 'eth', solana: 'solana', bsc: 'bsc', base: 'base', polygon: 'polygon_pos',
    arbitrum: 'arbitrum', optimism: 'optimism', avalanche: 'avax', fantom: 'fantom',
    cronos: 'cronos', linea: 'linea', zksync: 'zksync', blast: 'blast', scroll: 'scroll'
  };
  // DexScreener chainId -> GoPlus chain id (string 'solana' for Solana).
  var GOPLUS_CHAIN = {
    ethereum: '1', bsc: '56', polygon: '137', arbitrum: '42161', optimism: '10',
    base: '8453', avalanche: '43114', fantom: '250', cronos: '25', linea: '59144', solana: 'solana'
  };
  var GT_CHAINS = ['eth', 'solana', 'base']; // networks polled for trending / new pools

  // ---- freshness registry: panel key -> { source, at } ----
  var meta = {};
  function setFresh(key, source) { meta[key] = { source: source, at: Date.now() }; }
  function fresh(key) {
    var m = meta[key];
    if (!m) return { text: 'Not loaded yet', stale: true, source: null, at: null };
    var age = Date.now() - m.at;
    return { text: m.source + ' · ' + ago(age) + (age > 120000 ? ' · stale' : ''), stale: age > 120000, source: m.source, at: m.at, ageMs: age };
  }
  function ago(ms) {
    if (ms < 5000) return 'just now';
    if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
    return Math.floor(ms / 3600000) + 'h ago';
  }

  // ---- cache: memory first, localStorage second, both with TTLs ----
  var mem = new Map();
  var lsCache = {};
  try { lsCache = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { lsCache = {}; }
  function lsSave() {
    try {
      var s = JSON.stringify(lsCache);
      if (s.length > LS_MAX_BYTES) { // drop the oldest half when over budget
        var keys = Object.keys(lsCache).sort(function (a, b) { return lsCache[a].at - lsCache[b].at; });
        keys.slice(0, Math.ceil(keys.length / 2)).forEach(function (k) { delete lsCache[k]; });
        s = JSON.stringify(lsCache);
      }
      localStorage.setItem(LS_KEY, s);
    } catch (e) { /* storage full or blocked: memory cache still works */ }
  }
  function cacheGet(key, ttl) {
    var now = Date.now();
    var m = mem.get(key);
    if (m && now - m.at < ttl) return m.data;
    var l = lsCache[key];
    if (l && now - l.at < ttl) { mem.set(key, l); return l.data; }
    return null;
  }
  function cacheSet(key, data) {
    var entry = { at: Date.now(), data: data };
    mem.set(key, entry);
    lsCache[key] = entry;
    lsSave();
  }
  function clearCache() { mem.clear(); lsCache = {}; try { localStorage.removeItem(LS_KEY); } catch (e) {} }

  // ---- fetch with timeout, 429 backoff (retry once), JSON validation ----
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fetchJson(url, opts) {
    opts = opts || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(function (res) {
        clearTimeout(timer);
        if (res.status === 429) {
          var wait = 3000;
          var ra = res.headers.get('Retry-After');
          if (ra) { var n = parseInt(ra, 10); if (isFinite(n)) wait = Math.min(10000, n * 1000); }
          return sleep(wait).then(function () { return fetchJsonRetry(url); });
        }
        if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url.replace(/^https?:\/\/[^/]+/, ''));
        return res.json();
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (err && err.name === 'AbortError') throw new Error('Request timed out after ' + (TIMEOUT_MS / 1000) + 's');
        throw err;
      });
  }
  function fetchJsonRetry(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' (retry) from ' + url.replace(/^https?:\/\/[^/]+/, ''));
        return res.json();
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (err && err.name === 'AbortError') throw new Error('Request timed out after ' + (TIMEOUT_MS / 1000) + 's (retry)');
        throw err;
      });
  }

  // GeckoTerminal queue: at most ~1 request per GT_GAP_MS, in order.
  var gtChain = Promise.resolve();
  var lastGt = 0;
  function gtFetch(url) {
    var run = gtChain.then(function () {
      var wait = Math.max(0, GT_GAP_MS - (Date.now() - lastGt));
      return (wait ? sleep(wait) : Promise.resolve()).then(function () {
        lastGt = Date.now();
        return fetchJson(url);
      });
    });
    gtChain = run.then(function () {}, function () {});
    return run;
  }

  // ---- validation helpers ----
  function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
  function num(v) { var n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN); return isFinite(n) ? n : null; }
  function str(v) { return typeof v === 'string' && v ? v : null; }
  function okResult(data, source) { return { ok: true, data: data, error: null, source: source, at: Date.now() }; }
  function errResult(err, source) { return { ok: false, data: null, error: err && err.message ? err.message : String(err), source: source, at: Date.now() }; }

  // ---- normalization: one token shape for every source ----
  // { key, chainId, chainName, dexId, pairAddress, address, name, symbol, icon,
  //   priceUsd, chg5m, chg1h, chg6h, chg24h, volume24h, liquidityUsd, fdv, mcap,
  //   pairCreatedAt, txns24h {buys, sells}, url, source, boosted }
  function normDexPair(p) {
    if (!isObj(p) || !isObj(p.baseToken) || !str(p.baseToken.address)) return null;
    var price = num(p.priceUsd);
    var vol = p.volume && typeof p.volume === 'object' ? num(p.volume.h24) : null;
    var liq = p.liquidity && typeof p.liquidity === 'object' ? num(p.liquidity.usd) : null;
    var chg = p.priceChange && typeof p.priceChange === 'object' ? p.priceChange : {};
    var tx = p.txns && p.txns.h24 ? p.txns.h24 : {};
    return {
      key: p.chainId + ':' + p.baseToken.address.toLowerCase(),
      chainId: str(p.chainId) || 'unknown',
      chainName: CHAIN_NAMES[p.chainId] || (str(p.chainId) || 'Unknown'),
      dexId: str(p.dexId) || '',
      pairAddress: str(p.pairAddress) || '',
      address: p.baseToken.address,
      name: str(p.baseToken.name) || str(p.baseToken.symbol) || 'Unknown token',
      symbol: str(p.baseToken.symbol) || '?',
      icon: p.info && str(p.info.imageUrl),
      priceUsd: price,
      chg5m: num(chg.m5), chg1h: num(chg.h1), chg6h: num(chg.h6), chg24h: num(chg.h24),
      volume24h: vol, liquidityUsd: liq,
      fdv: num(p.fdv), mcap: num(p.marketCap),
      pairCreatedAt: typeof p.pairCreatedAt === 'number' ? p.pairCreatedAt : null,
      txns24h: { buys: typeof tx.buys === 'number' ? tx.buys : null, sells: typeof tx.sells === 'number' ? tx.sells : null },
      url: str(p.url) || '',
      source: 'DexScreener', boosted: false
    };
  }
  function normGtPool(pool, network) {
    if (!isObj(pool) || !isObj(pool.attributes)) return null;
    var a = pool.attributes;
    var rel = pool.relationships && pool.relationships.base_token && pool.relationships.base_token.data;
    var addr = rel && str(rel.id) ? rel.id.split('_').slice(1).join('_') : null;
    if (!addr) return null;
    var name = str(a.name) || '';
    var symbol = name.split('/')[0].trim().split(' ')[0] || '?';
    var chainId = network === 'eth' ? 'ethereum' : network === 'solana' ? 'solana' : network === 'bsc' ? 'bsc' : network === 'base' ? 'base' : network === 'polygon_pos' ? 'polygon' : network === 'arbitrum' ? 'arbitrum' : network === 'optimism' ? 'optimism' : network;
    var vol = a.volume_usd && typeof a.volume_usd === 'object' ? num(a.volume_usd.h24) : null;
    var chg = a.price_change_percentage && typeof a.price_change_percentage === 'object' ? a.price_change_percentage : {};
    var tx = a.transactions && a.transactions.h24 ? a.transactions.h24 : {};
    var created = a.pool_created_at ? Date.parse(a.pool_created_at) : null;
    return {
      key: chainId + ':' + addr.toLowerCase(),
      chainId: chainId,
      chainName: CHAIN_NAMES[chainId] || chainId,
      dexId: str(a.dex_id) || '',
      pairAddress: str(a.address) || '',
      address: addr,
      name: name.replace(/\s*\/.*$/, '').trim() || symbol,
      symbol: symbol,
      icon: null,
      priceUsd: num(a.base_token_price_usd),
      chg5m: null, chg1h: num(chg.h1), chg6h: null, chg24h: num(chg.h24),
      volume24h: vol, liquidityUsd: num(a.reserve_in_usd),
      fdv: num(a.fdv_usd), mcap: num(a.market_cap_usd),
      pairCreatedAt: isFinite(created) ? created : null,
      txns24h: { buys: typeof tx.buys === 'number' ? tx.buys : null, sells: typeof tx.sells === 'number' ? tx.sells : null },
      url: 'https://www.geckoterminal.com/' + network + '/pools/' + (a.address || ''),
      source: 'GeckoTerminal', boosted: false
    };
  }
  function dedupeByKey(list) {
    var seen = {};
    return list.filter(function (t) {
      if (!t || seen[t.key]) return false;
      seen[t.key] = true;
      return true;
    });
  }
  function byVolumeDesc(a, b) { return (b.volume24h || 0) - (a.volume24h || 0); }

  // ---- public API ----
  function search(q) {
    var key = 'search:' + q.toLowerCase();
    var hit = cacheGet(key, TTL.search);
    if (hit) return Promise.resolve(okResult(hit, 'DexScreener (cached)'));
    return fetchJson(DEX + '/latest/dex/search?q=' + encodeURIComponent(q))
      .then(function (d) {
        if (!isObj(d) || !Array.isArray(d.pairs)) throw new Error('DexScreener search returned an unexpected shape');
        var tokens = d.pairs.map(normDexPair).filter(Boolean);
        cacheSet(key, tokens);
        setFresh('search', 'DexScreener');
        return okResult(tokens, 'DexScreener');
      })
      .catch(function (e) { return errResult(e, 'DexScreener'); });
  }

  function tokenPairs(address) {
    var key = 'pairs:' + address.toLowerCase();
    var hit = cacheGet(key, TTL.pairs);
    if (hit) return Promise.resolve(okResult(hit, 'DexScreener (cached)'));
    return fetchJson(DEX + '/latest/dex/tokens/' + encodeURIComponent(address))
      .then(function (d) {
        if (!isObj(d) || !Array.isArray(d.pairs)) throw new Error('DexScreener token lookup returned an unexpected shape');
        var tokens = d.pairs.map(normDexPair).filter(Boolean);
        cacheSet(key, tokens);
        setFresh('pairs', 'DexScreener');
        return okResult(tokens, 'DexScreener');
      })
      .catch(function (e) { return errResult(e, 'DexScreener'); });
  }

  function trending() {
    var key = 'trending';
    var hit = cacheGet(key, TTL.trending);
    if (hit) return Promise.resolve(okResult(hit, 'GeckoTerminal (cached)'));
    var boosted = fetchJson(DEX + '/token-boosts/top/v1')
      .then(function (d) {
        if (!Array.isArray(d)) return {};
        var set = {};
        d.forEach(function (b) {
          if (b && str(b.chainId) && str(b.tokenAddress)) set[b.chainId + ':' + b.tokenAddress.toLowerCase()] = true;
        });
        return set;
      })
      .catch(function () { return {}; });
    var pools = Promise.all(GT_CHAINS.map(function (n) {
      return gtFetch(GT + '/networks/' + n + '/trending_pools?page=1')
        .then(function (d) {
          if (!isObj(d) || !Array.isArray(d.data)) throw new Error('GeckoTerminal trending_pools returned an unexpected shape');
          return d.data.map(function (p) { return normGtPool(p, n); }).filter(Boolean);
        })
        .catch(function () { return []; });
    }));
    return Promise.all([boosted, pools]).then(function (parts) {
      var set = parts[0];
      var all = dedupeByKey([].concat.apply([], parts[1])).sort(byVolumeDesc);
      all.forEach(function (t) { if (set[t.key]) t.boosted = true; });
      if (!all.length) return errResult(new Error('Trending pools unavailable from GeckoTerminal right now'), 'GeckoTerminal');
      cacheSet(key, all);
      setFresh('trending', 'GeckoTerminal');
      return okResult(all, 'GeckoTerminal');
    });
  }

  function newLaunches() {
    var key = 'new';
    var hit = cacheGet(key, TTL.fresh);
    if (hit) return Promise.resolve(okResult(hit, 'GeckoTerminal (cached)'));
    return Promise.all(GT_CHAINS.map(function (n) {
      return gtFetch(GT + '/networks/' + n + '/new_pools?page=1')
        .then(function (d) {
          if (!isObj(d) || !Array.isArray(d.data)) throw new Error('GeckoTerminal new_pools returned an unexpected shape');
          return d.data.map(function (p) { return normGtPool(p, n); }).filter(Boolean);
        })
        .catch(function () { return []; });
    })).then(function (parts) {
      var all = dedupeByKey([].concat.apply([], parts))
        .sort(function (a, b) { return (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0); });
      if (!all.length) return errResult(new Error('New pools unavailable from GeckoTerminal right now'), 'GeckoTerminal');
      cacheSet(key, all);
      setFresh('new', 'GeckoTerminal');
      return okResult(all, 'GeckoTerminal');
    });
  }

  // Timeframe mapping: UI label -> GeckoTerminal {unit, aggregate}.
  var TF_MAP = {
    '1m': { unit: 'minute', agg: 1 }, '5m': { unit: 'minute', agg: 5 },
    '15m': { unit: 'minute', agg: 15 }, '1h': { unit: 'hour', agg: 1 },
    '4h': { unit: 'hour', agg: 4 }, '24h': { unit: 'day', agg: 1 }
  };
  function ohlcv(chainId, poolAddress, tf) {
    var map = TF_MAP[tf] || TF_MAP['1h'];
    var network = GT_NETWORK[chainId];
    if (!network || !poolAddress) return Promise.resolve(errResult(new Error('No chart pool for this token on a supported network'), 'GeckoTerminal'));
    var key = 'ohlcv:' + network + ':' + poolAddress.toLowerCase() + ':' + tf;
    var hit = cacheGet(key, TTL.ohlcv);
    if (hit) return Promise.resolve(okResult(hit, 'GeckoTerminal (cached)'));
    var url = GT + '/networks/' + network + '/pools/' + poolAddress + '/ohlcv/' + map.unit + '?aggregate=' + map.agg + '&limit=100';
    return gtFetch(url)
      .then(function (d) {
        var list = d && d.data && d.data.attributes && Array.isArray(d.data.attributes.ohlcv_list) ? d.data.attributes.ohlcv_list : null;
        if (!list) throw new Error('GeckoTerminal OHLCV returned an unexpected shape');
        var candles = list.filter(function (c) { return Array.isArray(c) && c.length >= 6; })
          .map(function (c) { return { t: c[0] * 1000, o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] }; })
          .sort(function (a, b) { return a.t - b.t; });
        cacheSet(key, candles);
        setFresh('ohlcv', 'GeckoTerminal');
        return okResult(candles, 'GeckoTerminal');
      })
      .catch(function (e) { return errResult(e, 'GeckoTerminal'); });
  }

  function security(chainId, address) {
    var gid = GOPLUS_CHAIN[chainId];
    if (!gid) return Promise.resolve({ ok: false, data: null, error: 'GoPlus does not cover the ' + chainId + ' chain', source: 'GoPlus', at: Date.now(), unsupported: true });
    var key = 'sec:' + gid + ':' + address.toLowerCase();
    var hit = cacheGet(key, TTL.security);
    if (hit) return Promise.resolve(okResult(hit, 'GoPlus (cached)'));
    return fetchJson(GOPLUS + '/token_security/' + gid + '?contract_addresses=' + encodeURIComponent(address))
      .then(function (d) {
        if (!isObj(d) || d.code !== 1 || !isObj(d.result)) throw new Error('GoPlus returned an unexpected shape');
        var raw = d.result[address.toLowerCase()] || d.result[address] || null;
        if (!raw) throw new Error('GoPlus has no security record for this token');
        var sec = normalizeSecurity(raw);
        cacheSet(key, sec);
        setFresh('security', 'GoPlus');
        return okResult(sec, 'GoPlus');
      })
      .catch(function (e) { return errResult(e, 'GoPlus'); });
  }
  function flag(v) { // GoPlus uses '1'/'0' strings
    if (v === '1' || v === 1 || v === true) return true;
    if (v === '0' || v === 0 || v === false) return false;
    return null;
  }
  function normalizeSecurity(r) {
    function pct(v) { var n = num(v); return n === null ? null : n; }
    return {
      name: str(r.token_name), symbol: str(r.token_symbol),
      openSource: flag(r.is_open_source), isProxy: flag(r.is_proxy),
      mintable: flag(r.is_mintable), owner: str(r.owner_address),
      honeypot: flag(r.is_honeypot), cannotBuy: flag(r.cannot_buy), cannotSellAll: flag(r.cannot_sell_all),
      buyTax: pct(r.buy_tax), sellTax: pct(r.sell_tax),
      antiWhale: flag(r.is_anti_whale), tradingCooldown: flag(r.trading_cooldown),
      transferPausable: flag(r.transfer_pausable), blacklisted: flag(r.is_blacklisted),
      hiddenOwner: flag(r.hidden_owner), selfdestruct: flag(r.selfdestruct),
      holderCount: num(r.holder_count), lpHolderCount: num(r.lp_holder_count),
      holders: Array.isArray(r.holders) ? r.holders.slice(0, 10).map(function (h) {
        return { address: str(h.address) || '', tag: str(h.tag) || '', percent: num(h.percent), locked: flag(h.is_locked) };
      }) : null,
      dexList: Array.isArray(r.dex) ? r.dex.map(function (x) { return str(x.name) || str(x.liquidity_type) || ''; }).filter(Boolean) : [],
      airdropScam: flag(r.is_airdrop_scam), trueToken: flag(r.is_true_token),
      raw: r
    };
  }

  // Refresh a watchlist item's price from DexScreener (batched, up to 30 addresses).
  function refreshPrices(items) {
    var addrs = items.map(function (i) { return i.address; }).filter(Boolean);
    if (!addrs.length) return Promise.resolve(okResult([], 'DexScreener'));
    var url = DEX + '/latest/dex/tokens/' + addrs.slice(0, 30).map(encodeURIComponent).join(',');
    return fetchJson(url)
      .then(function (d) {
        if (!isObj(d) || !Array.isArray(d.pairs)) throw new Error('DexScreener refresh returned an unexpected shape');
        var tokens = d.pairs.map(normDexPair).filter(Boolean);
        setFresh('watchlist', 'DexScreener');
        return okResult(tokens, 'DexScreener');
      })
      .catch(function (e) { return errResult(e, 'DexScreener'); });
  }

  window.RadarAPI = {
    search: search, tokenPairs: tokenPairs, trending: trending, newLaunches: newLaunches,
    ohlcv: ohlcv, security: security, refreshPrices: refreshPrices,
    fresh: fresh, clearCache: clearCache,
    chainName: function (id) { return CHAIN_NAMES[id] || id; },
    gtNetwork: function (chainId) { return GT_NETWORK[chainId] || null; },
    goplusSupported: function (chainId) { return !!GOPLUS_CHAIN[chainId]; },
    TF_MAP: TF_MAP
  };
})();
