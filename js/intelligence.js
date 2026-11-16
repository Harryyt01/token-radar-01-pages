// Token Radar V2 — token intelligence.
// Detail modal + risk scanner, built on GoPlus token_security.
// NEVER labels a token "Safe": it reports a risk score and explicit warnings
// only. Any field GoPlus does not return is shown as "Unknown — not verified",
// never invented.
(function () {
  'use strict';

  var D = window.RadarDiscovery;
  var esc = D.esc;

  function flagText(v, yesLabel, noLabel) {
    if (v === true) return yesLabel;
    if (v === false) return noLabel;
    return 'Unknown — not verified';
  }
  function pct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v * 100).toFixed(1) + '%';
  }

  // Risk score from GoPlus flags. Bands only — never a safety verdict.
  function riskScore(sec) {
    var score = 0;
    var warnings = [];
    if (!sec) return { score: null, band: 'Not checked', warnings: ['Security data unavailable — no checks were run.'] };
    if (sec.honeypot) { score += 100; warnings.push('HONEYPOT: GoPlus flags this token as a honeypot — buys may succeed while sells fail.'); }
    if (sec.cannotBuy) { score += 80; warnings.push('Cannot buy: this token cannot be bought through the usual path.'); }
    if (sec.cannotSellAll) { score += 80; warnings.push('Cannot sell all: holders may not be able to sell their full balance.'); }
    if (sec.airdropScam) { score += 50; warnings.push('Airdrop scam flag: GoPlus links this token to airdrop scam behaviour.'); }
    var tax = Math.max(sec.buyTax || 0, sec.sellTax || 0);
    if (tax > 25) { score += 40; warnings.push('Very high tax: buy ' + (sec.buyTax ?? '—') + '% / sell ' + (sec.sellTax ?? '—') + '%.'); }
    else if (tax > 10) { score += 20; warnings.push('High tax: buy ' + (sec.buyTax ?? '—') + '% / sell ' + (sec.sellTax ?? '—') + '%.'); }
    if (sec.mintable) { score += 15; warnings.push('Mintable: the contract owner can mint new tokens.'); }
    if (sec.hiddenOwner) { score += 20; warnings.push('Hidden owner: the real owner address is obscured.'); }
    if (sec.openSource === false) { score += 15; warnings.push('Contract is not open source — it cannot be independently verified.'); }
    if (sec.selfdestruct) { score += 25; warnings.push('Self-destruct: the contract can destroy itself.'); }
    if (sec.transferPausable) { score += 10; warnings.push('Transfers can be paused by the contract.'); }
    if (sec.blacklisted) { score += 15; warnings.push('Blacklist function present: addresses can be blocked from trading.'); }
    if (sec.tradingCooldown) { score += 5; warnings.push('Trading cooldown: buys/sells may be throttled.'); }
    if (sec.holders && sec.holders.length) {
      var top = sec.holders[0];
      if (top && top.percent !== null && top.percent > 0.5) { score += 25; warnings.push('Top holder controls ' + pct(top.percent) + ' of supply.'); }
      else if (top && top.percent !== null && top.percent > 0.3) { score += 15; warnings.push('Top holder controls ' + pct(top.percent) + ' of supply.'); }
    }
    var band = score >= 60 ? 'Critical' : score >= 30 ? 'High' : score >= 10 ? 'Moderate' : 'Low';
    if (!warnings.length) warnings.push('No issues found in these checks. This is not a safety verdict — always verify before trading.');
    return { score: score, band: band, warnings: warnings };
  }

  function checkRow(label, value, tone) {
    return '<div class="check-row' + (tone ? ' ' + tone : '') + '"><span class="dim">' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }
  function sectionHtml(title, inner) {
    return '<section class="intel-section"><h3>' + esc(title) + '</h3>' + inner + '</section>';
  }

  function securityHtml(sec, chainId) {
    if (!sec) {
      return sectionHtml('Contract security', '<p class="dim">Security data unavailable for this token. GoPlus returned no record' + (chainId ? ' for ' + esc(chainId) : '') + '.</p>');
    }
    var raw = sec.raw || {};
    var freeze = raw.is_freezable;
    var freezeText = freeze === '1' ? 'Yes — transfers can be frozen' : freeze === '0' ? 'No freeze function found' : 'Unknown — not verified';
    var rows = '';
    rows += checkRow('Contract verified (open source)', flagText(sec.openSource, 'Yes — source is public', 'No — source is not public'), sec.openSource === false ? 'warn' : '');
    rows += checkRow('Mint authority', flagText(sec.mintable, 'Mintable — new supply can be created', 'Not mintable'), sec.mintable ? 'warn' : '');
    rows += checkRow('Freeze authority', freezeText, freeze === '1' ? 'warn' : '');
    rows += checkRow('Proxy contract', flagText(sec.isProxy, 'Yes — logic can be changed', 'No'), sec.isProxy ? 'warn' : '');
    rows += checkRow('Owner', sec.owner ? sec.owner.slice(0, 6) + '…' + sec.owner.slice(-4) : 'Unknown — not verified', sec.hiddenOwner ? 'warn' : '');
    rows += checkRow('Hidden owner', flagText(sec.hiddenOwner, 'Yes', 'No'), sec.hiddenOwner ? 'warn' : '');
    rows += checkRow('Honeypot', flagText(sec.honeypot, 'YES — flagged as honeypot', 'No'), sec.honeypot ? 'bad' : '');
    rows += checkRow('Buy tax', sec.buyTax === null ? 'Unknown' : sec.buyTax + '%', (sec.buyTax || 0) > 10 ? 'warn' : '');
    rows += checkRow('Sell tax', sec.sellTax === null ? 'Unknown' : sec.sellTax + '%', (sec.sellTax || 0) > 10 ? 'warn' : '');
    rows += checkRow('Can buy', flagText(sec.cannotBuy, 'No — buys blocked', 'Yes'), sec.cannotBuy ? 'bad' : '');
    rows += checkRow('Can sell all', flagText(sec.cannotSellAll, 'No — sells restricted', 'Yes'), sec.cannotSellAll ? 'bad' : '');
    rows += checkRow('Transfers pausable', flagText(sec.transferPausable, 'Yes', 'No'), sec.transferPausable ? 'warn' : '');
    rows += checkRow('Blacklist function', flagText(sec.blacklisted, 'Yes — addresses can be blocked', 'No'), sec.blacklisted ? 'warn' : '');
    rows += checkRow('Anti-whale limits', flagText(sec.antiWhale, 'Yes', 'No'));
    rows += checkRow('Self-destruct', flagText(sec.selfdestruct, 'Yes — contract can self-destruct', 'No'), sec.selfdestruct ? 'bad' : '');
    rows += checkRow('Airdrop scam flag', flagText(sec.airdropScam, 'Yes', 'No'), sec.airdropScam ? 'bad' : '');
    var html = '<div class="check-grid">' + rows + '</div>';
    // Liquidity lock / burn: only what GoPlus actually reports.
    var locked = (sec.holders || []).filter(function (h) { return h.locked; });
    var lockText = 'Unknown — not verified';
    if (sec.holders && sec.holders.length) {
      lockText = locked.length
        ? locked.length + ' of the top ' + sec.holders.length + ' holders are locked'
        : 'No locked holders among the top ' + sec.holders.length + ' holders reported';
    }
    html += sectionHtml('Liquidity lock / burn', '<p>' + esc(lockText) + '</p><p class="dim">GoPlus reports lock status per top holder only; a full lock/burn proof is not available from this source.</p>');
    return sectionHtml('Contract security', html);
  }

  function holdersHtml(sec) {
    if (!sec || !sec.holders || !sec.holders.length) {
      return sectionHtml('Holder distribution', '<p class="dim">Holder data unavailable for this token. GoPlus returned no holder list — no distribution is shown rather than an invented one.</p>');
    }
    var rows = sec.holders.map(function (h, i) {
      return '<tr><td>' + (i + 1) + '</td><td class="mono">' + esc(h.address ? h.address.slice(0, 6) + '…' + h.address.slice(-4) : '—') + '</td><td>' + esc(h.tag || '—') + '</td><td class="num">' + pct(h.percent) + '</td><td>' + (h.locked === true ? 'Locked' : h.locked === false ? '—' : 'Unknown') + '</td></tr>';
    }).join('');
    var count = sec.holderCount !== null && sec.holderCount !== undefined
      ? '<p>Total holders: <b>' + Number(sec.holderCount).toLocaleString('en-US') + '</b> (GoPlus)</p>' : '';
    return sectionHtml('Holder distribution',
      count +
      '<div class="table-wrap"><table class="mini"><thead><tr><th>#</th><th>Address</th><th>Tag</th><th>Share</th><th>Lock</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="dim">Top holders only — GoPlus reports the largest holders, not the full distribution.</p>');
  }

  function riskHtml(sec) {
    var r = riskScore(sec);
    var bar = r.score === null ? '' : '<div class="risk-bar"><i style="width:' + Math.min(100, r.score) + '%" class="band-' + r.band.toLowerCase() + '"></i></div>';
    var warns = r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    return sectionHtml('Risk assessment',
      '<div class="risk-head"><span class="risk-band band-' + r.band.toLowerCase() + '">' + esc(r.band) + ' risk' + (r.score === null ? '' : ' · score ' + r.score + '/100') + '</span></div>' +
      bar +
      '<ul class="warnings">' + warns + '</ul>' +
      '<p class="dim">This score comes only from the checks above. It is not a safety verdict and not investment advice.</p>');
  }

  // Full security report into a container (used by the Risk Scanner view).
  function renderSecurityReport(host, chainId, address) {
    host.innerHTML = '<div class="panel"><div class="skeleton-line"></div><div class="skeleton-line"></div><p class="dim">Checking ' + esc(address) + ' on ' + esc(chainId) + ' via GoPlus…</p></div>';
    return window.RadarAPI.security(chainId, address).then(function (res) {
      if (!res.ok) {
        host.innerHTML = '<div class="panel error-state"><h3>Security check unavailable</h3><p>' + esc(res.error) + '</p><button type="button" class="button primary">Retry</button></div>';
        host.querySelector('button').addEventListener('click', function () { renderSecurityReport(host, chainId, address); });
        return res;
      }
      host.innerHTML = riskHtml(res.data) + securityHtml(res.data, chainId) + holdersHtml(res.data);
      return res;
    });
  }

  // Load GoPlus badges for the first few tokens of a list (bounded, staggered).
  function refreshBadges(tokens) {
    (tokens || []).slice(0, 8).forEach(function (t, i) {
      setTimeout(function () {
        if (!window.RadarAPI.goplusSupported(t.chainId)) {
          var el0 = document.querySelector('[data-risk-for="' + CSS.escape(t.key) + '"]');
          if (el0) el0.textContent = 'Risk: chain not covered';
          return;
        }
        window.RadarAPI.security(t.chainId, t.address).then(function (res) {
          var el = document.querySelector('[data-risk-for="' + CSS.escape(t.key) + '"]');
          if (!el) return;
          if (!res.ok) { el.textContent = res.noRecord ? 'Risk: no record' : res.unavailable ? 'Risk: unavailable' : 'Risk: check failed'; return; }
          var r = riskScore(res.data);
          el.textContent = 'Risk: ' + r.band + (r.score !== null ? ' ' + r.score : '');
          el.classList.add('band-' + r.band.toLowerCase());
        });
      }, i * 250);
    });
  }

  // Token detail modal: header + chart + liquidity + security + holders.
  function openTokenDetail(token) {
    var old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', token.name + ' details');
    var watched = window.RadarWatchlist.has(token);
    modal.innerHTML =
      '<div class="modal-head">' +
        '<div class="token-head">' +
          '<div class="token-logo">' + esc((token.symbol || '?').slice(0, 2).toUpperCase()) + '</div>' +
          '<div class="token-names"><b>' + esc(token.name) + '</b><span class="dim">' + esc(token.symbol) + ' · ' + esc(token.chainName) + '</span></div>' +
        '</div>' +
        '<button type="button" class="close-btn" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="modal-price"><b>' + D.fmtPrice(token.priceUsd) + '</b><span class="chg ' + (token.chg24h >= 0 ? 'pos' : 'neg') + '">' + D.fmtChg(token.chg24h) + ' 24h</span>' +
      '<button type="button" class="watch-btn' + (watched ? ' on' : '') + '">' + (watched ? '★ Watching' : '☆ Watch') + '</button></div>' +
      '<div class="modal-grid">' +
        '<div><span class="dim">Liquidity</span><b>' + D.fmtUsd(token.liquidityUsd) + '</b></div>' +
        '<div><span class="dim">24h volume</span><b>' + D.fmtUsd(token.volume24h) + '</b></div>' +
        '<div><span class="dim">Market cap</span><b>' + D.fmtUsd(token.mcap !== null && token.mcap !== undefined ? token.mcap : token.fdv) + '</b></div>' +
        '<div><span class="dim">Age</span><b>' + D.fmtAge(token.pairCreatedAt) + '</b></div>' +
        '<div><span class="dim">24h buys / sells</span><b>' + (token.txns24h.buys ?? '—') + ' / ' + (token.txns24h.sells ?? '—') + '</b></div>' +
        '<div><span class="dim">Contract</span><b class="mono addr-copy" title="Copy contract address">' + D.shortAddr(token.address) + '</b></div>' +
      '</div>' +
      '<div class="modal-chart"></div>' +
      '<div class="modal-sec"><p class="dim">Loading security checks…</p></div>' +
      '<p class="dim modal-source">Price: ' + esc(token.source || 'DexScreener') + ' · Security: GoPlus · Chart: GeckoTerminal</p>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');
    var chart = window.RadarChart.create(modal.querySelector('.modal-chart'), token);
    var close = function () { chart.destroy(); overlay.remove(); document.body.classList.remove('modal-open'); };
    modal.querySelector('.close-btn').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    modal.querySelector('.watch-btn').addEventListener('click', function (e) {
      var added = window.RadarWatchlist.toggle(token);
      e.currentTarget.classList.toggle('on', added);
      e.currentTarget.textContent = added ? '★ Watching' : '☆ Watch';
    });
    modal.querySelector('.addr-copy').addEventListener('click', function (e) {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(token.address).then(function () { e.currentTarget.textContent = 'Copied ✓'; });
    });
    var secHost = modal.querySelector('.modal-sec');
    window.RadarAPI.security(token.chainId, token.address).then(function (res) {
      if (!res.ok) {
        secHost.innerHTML = '<p class="dim">Security check unavailable: ' + esc(res.error) + '</p>';
        return;
      }
      secHost.innerHTML = riskHtml(res.data) + securityHtml(res.data, token.chainId) + holdersHtml(res.data);
    });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); }
    });
    return { close: close };
  }

  window.RadarIntel = {
    openTokenDetail: openTokenDetail,
    renderSecurityReport: renderSecurityReport,
    refreshBadges: refreshBadges,
    riskScore: riskScore
  };
})();
