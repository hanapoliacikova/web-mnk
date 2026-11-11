/* Schvaľovanie kreatív: klientska stránka.
   Obsah kampane: /schvalovanie/<klient>/kampan.json
   Stav (schválené, na úpravu): Netlify Function /api/schvalovanie */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var m = location.pathname.match(/^\/schvalovanie\/([a-z0-9-]+)\/?$/);
  var slug = m ? m[1] : null;
  var API = '/api/schvalovanie';
  var NAZVY = { schvalene: 'Schválené', uprava: 'Na úpravu', caka: 'Čaká' };
  var s = { kampan: null, stav: {}, filter: null, otvorene: null, nacitane: false };

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cas(iso) { try { return new Date(iso).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function den(d) { try { return new Date(d + 'T12:00:00').toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; } }
  var tt;
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, 2600); }
  function sprava(t, chyba) { var el = $('sprava'); el.textContent = t || ''; el.classList.toggle('chyba', !!chyba); }
  function stavOf(id) { return (s.stav[id] && s.stav[id].status) || 'caka'; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var menoEl = $('meno');
  menoEl.value = ls('mnk-schvalovanie-meno') || '';
  menoEl.addEventListener('input', function () { menoEl.classList.remove('chyba'); ls('mnk-schvalovanie-meno', menoEl.value.trim()); });

  function media(v) {
    var subory = v.obrazky || (v.obrazok ? [v.obrazok] : []);
    var items = subory.map(function (f, i) {
      var src = /^https?:|^\//.test(f) ? f : '/schvalovanie/' + slug + '/' + f;
      var alt = v.nazov + (subory.length > 1 ? ', obrázok ' + (i + 1) : '');
      return /\.(mp4|webm|mov)$/i.test(f)
        ? '<video src="' + esc(src) + '" controls muted playsinline preload="metadata" aria-label="' + esc(alt) + '"></video>'
        : '<img src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy">';
    }).join('');
    return '<div class="k-media"><div class="k-slides">' + items + '</div>' +
      (v.format ? '<span class="k-fmt">' + esc(v.format) + '</span>' : '') +
      (subory.length > 1 ? '<span class="k-count">' + subory.length + ' snímky, posuňte do strany</span>' : '') + '</div>';
  }

  function karta(v) {
    var d = s.stav[v.id] || {};
    var st = d.status || 'caka';
    var fb = '';
    if (st === 'uprava') fb = '<div class="fb"><div class="lbl">Čo upraviť</div>' + esc(d.poznamka) + '<small>' + esc(d.meno || 'Klient') + ', ' + esc(cas(d.cas)) + '</small></div>';
    if (st === 'schvalene') fb = '<div class="fb ok">Schválené' + (d.poznamka ? ': ' + esc(d.poznamka) : '') + '<small>' + esc(d.meno || 'Klient') + ', ' + esc(cas(d.cas)) + '</small></div>';
    var akcie;
    if (s.otvorene === v.id) {
      akcie = '<div class="k-edit"><label class="lbl" for="pozn-' + esc(v.id) + '">Čo treba upraviť?</label>' +
        '<textarea id="pozn-' + esc(v.id) + '" data-pozn="' + esc(v.id) + '" maxlength="2000" placeholder="Napríklad: väčšie logo, kratší text, iná fotka">' + (st === 'uprava' ? esc(d.poznamka) : '') + '</textarea>' +
        '<div class="k-actions"><button class="btn upravit" type="button" data-a="odoslat" data-id="' + esc(v.id) + '">Odoslať na úpravu</button><button class="btn" type="button" data-a="zrusit">Zrušiť</button></div></div>';
    } else {
      akcie = '<div class="k-actions"><button class="btn schvalit" type="button" data-a="schvalit" data-id="' + esc(v.id) + '"' + (st === 'schvalene' ? ' disabled' : '') + '>' + (st === 'schvalene' ? 'Schválené' : 'Schváliť') + '</button>' +
        '<button class="btn upravit" type="button" data-a="upravit" data-id="' + esc(v.id) + '">Upraviť</button></div>' +
        (st !== 'caka' ? '<button class="btn link" type="button" data-a="vratit" data-id="' + esc(v.id) + '">Vrátiť do stavu čaká</button>' : '');
    }
    return '<article class="k" data-stav="' + st + '">' + media(v) + '<div class="k-body">' +
      '<div class="k-row"><span class="k-name">' + esc(v.nazov) + '</span><span class="pill ' + st + '">' + NAZVY[st] + '</span></div>' +
      (v.nadpis ? '<div><div class="lbl">Nadpis</div><div class="k-head">' + esc(v.nadpis) + '</div></div>' : '') +
      (v.text ? '<div><div class="lbl">Text</div><div class="k-text">' + esc(v.text) + '</div></div>' : '') +
      (v.cta ? '<div><div class="lbl">Výzva k akcii</div><span class="k-cta">' + esc(v.cta) + '</span></div>' : '') +
      fb + akcie + '</div></article>';
  }

  function render() {
    var k = s.kampan;
    var varianty = (k && k.varianty) || [];
    var ok = 0, up = 0;
    varianty.forEach(function (v) { var x = stavOf(v.id); if (x === 'schvalene') ok++; else if (x === 'uprava') up++; });
    var caka = varianty.length - ok - up, n = varianty.length;
    $('nOk').textContent = ok; $('nUprava').textContent = up; $('nCaka').textContent = caka;
    $('barOk').style.width = n ? (ok / n * 100) + '%' : '0';
    $('barUprava').style.width = n ? (up / n * 100) + '%' : '0';
    $('postup').textContent = !s.nacitane ? 'Načítavam návrhy…' : n ? 'Rozhodnuté ' + (ok + up) + ' z ' + n + ' variantov' : 'Zatiaľ žiadne varianty';
    document.querySelectorAll('.s-stat').forEach(function (b) { b.setAttribute('aria-pressed', String(s.filter === b.dataset.filter)); });

    var grid = $('grid');
    var rozpis = s.otvorene ? (document.querySelector('[data-pozn="' + s.otvorene + '"]') || {}).value : null;
    if (!k) return;
    var list = varianty.filter(function (v) { return !s.filter || stavOf(v.id) === s.filter; });
    grid.innerHTML = !n ? '<div class="s-empty"><h2 class="bb">Zatiaľ žiadne návrhy</h2>Varianty sem čoskoro pridáme.</div>'
      : list.length ? list.map(karta).join('')
      : '<div class="s-empty"><h2 class="bb">Nič v tomto stave</h2>Kliknite znova na súhrn hore a zobrazia sa všetky varianty.</div>';
    if (rozpis != null) { var ta = document.querySelector('[data-pozn="' + s.otvorene + '"]'); if (ta) ta.value = rozpis; }
  }

  function hlavicka(k) {
    document.title = (k.klient ? k.klient + ': ' : '') + 'schvaľovanie kreatív | Marketing na kľúč';
    $('titul').textContent = k.kampan || 'Schvaľovanie kreatív';
    var p = [];
    if (k.klient) p.push('Klient <b>' + esc(k.klient) + '</b>');
    if (k.kanal) p.push('Kanál <b>' + esc(k.kanal) + '</b>');
    if (k.termin) p.push('Termín schválenia <b>' + esc(den(k.termin)) + '</b>');
    $('meta').innerHTML = p.join('');
    if (k.uvod) $('uvod').textContent = k.uvod;
  }

  function nacitajStav() {
    return fetch(API + '?klient=' + encodeURIComponent(slug), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        s.stav = j.stav || {};
        $('aktualizovane').textContent = 'Stav aktualizovaný o ' + new Date().toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }) + '.';
        if ($('sprava').classList.contains('chyba')) sprava('');
        render();
      })
      .catch(function () { sprava('Stav schvaľovania sa nepodarilo načítať. Skúste obnoviť stránku.', true); });
  }

  function rozhodni(id, status, poznamka) {
    var meno = menoEl.value.trim();
    if (!meno) { menoEl.classList.add('chyba'); menoEl.focus(); toast('Najprv napíšte svoje meno, aby sme vedeli, kto rozhodol.'); return; }
    var predtym = s.stav[id];
    s.stav[id] = { status: status, poznamka: poznamka || '', meno: meno, cas: new Date().toISOString() };
    s.otvorene = null; render();
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ klient: slug, variant: id, status: status, poznamka: poznamka || '', meno: meno }) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { s.stav[id] = j.zaznam; render(); toast(status === 'schvalene' ? 'Schválené' : status === 'uprava' ? 'Odoslané na úpravu' : 'Vrátené do stavu čaká'); })
      .catch(function () { if (predtym) s.stav[id] = predtym; else delete s.stav[id]; render(); toast('Uloženie zlyhalo, skúste to znova.'); });
  }

  $('grid').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    var id = b.dataset.id;
    if (b.dataset.a === 'schvalit') rozhodni(id, 'schvalene', '');
    else if (b.dataset.a === 'upravit') { s.otvorene = id; render(); var ta = document.querySelector('[data-pozn="' + id + '"]'); if (ta) ta.focus(); }
    else if (b.dataset.a === 'zrusit') { s.otvorene = null; render(); }
    else if (b.dataset.a === 'odoslat') {
      var t = (document.querySelector('[data-pozn="' + id + '"]') || {}).value || '';
      if (!t.trim()) { toast('Napíšte, čo treba upraviť.'); return; }
      rozhodni(id, 'uprava', t.trim());
    }
    else if (b.dataset.a === 'vratit') rozhodni(id, 'caka', '');
  });
  document.querySelectorAll('.s-stat').forEach(function (b) {
    b.addEventListener('click', function () { s.filter = s.filter === b.dataset.filter ? null : b.dataset.filter; render(); });
  });

  if (!slug) { $('grid').innerHTML = '<div class="s-empty"><h2 class="bb">Stránka sa nenašla</h2>Skontrolujte odkaz, ktorý ste od nás dostali.</div>'; return; }
  fetch('/schvalovanie/' + slug + '/kampan.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (k) { s.kampan = k; s.nacitane = true; hlavicka(k); render(); return nacitajStav(); })
    .catch(function () {
      s.nacitane = true; render();
      $('grid').innerHTML = '<div class="s-empty"><h2 class="bb">Stránka sa nenašla</h2>Skontrolujte odkaz, ktorý ste od nás dostali, alebo nám napíšte.</div>';
    });
  // obnova stavu, aby klient aj agentúra videli zmeny druhej strany
  setInterval(function () { if (s.kampan && !document.hidden && !s.otvorene) nacitajStav(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && s.kampan && !s.otvorene) nacitajStav(); });
})();
