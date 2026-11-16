// Token Radar V2 — watchlist, stored in localStorage.
// Items: { key, chainId, address, pairAddress, name, symbol, icon, addedAt }.
// Live prices are refreshed by the app through RadarAPI.refreshPrices.
(function () {
  'use strict';
  var KEY = 'radarv2.watchlist.v1';
  var listeners = [];

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (i) { return i && i.key && i.address; }) : [];
    } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
    listeners.forEach(function (fn) { try { fn(list); } catch (e) {} });
  }
  function keyOf(t) { return (t.chainId || 'unknown') + ':' + String(t.address || '').toLowerCase(); }

  window.RadarWatchlist = {
    all: load,
    has: function (t) { return load().some(function (i) { return i.key === keyOf(t); }); },
    add: function (t) {
      var list = load();
      var key = keyOf(t);
      if (list.some(function (i) { return i.key === key; })) return list;
      list.push({
        key: key, chainId: t.chainId || 'unknown', address: t.address,
        pairAddress: t.pairAddress || '', name: t.name || t.symbol || 'Unknown',
        symbol: t.symbol || '?', icon: t.icon || null, addedAt: Date.now()
      });
      save(list);
      return list;
    },
    remove: function (key) {
      var list = load().filter(function (i) { return i.key !== key; });
      save(list);
      return list;
    },
    toggle: function (t) {
      if (this.has(t)) { this.remove(keyOf(t)); return false; }
      this.add(t);
      return true;
    },
    clear: function () { save([]); },
    onChange: function (fn) { listeners.push(fn); },
    keyOf: keyOf
  };
})();
