/* Prehľad schvaľovania pre tím MNK. Heslo = premenná TIM_HESLO v Netlify. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var NAZVY = { schvalene: 'Schválené', uprava: 'Na úpravu', caka: 'Čaká' };
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cas(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }

  function klientHTML(k, kampan) {
    var varianty = (kampan && kampan.varianty) || Object.keys(k.stav).map(function (id) { return { id: id, nazov: id }; });
    var ok = 0, up = 0;
    var riadky = varianty.map(function (v) {
      var z = k.stav[v.id] || {}; var st = z.status || 'caka';
      if (st === 'schvalene') ok++; if (st === 'uprava') up++;
      return '<tr><td>' + esc(v.nazov) + '</td><td><span class="pill ' + st + '">' + NAZVY[st] + '</span></td><td class="note">' + esc(z.poznamka) + '</td><td>' + esc(z.meno) + '</td><td>' + esc(cas(z.cas)) + '</td></tr>';
    }).join('');
    var odkaz = location.origin + '/schvalovanie/' + k.slug + '/';
    return '<article class="p-client"><div class="p-top"><div><h2 class="bb">' + esc(k.klient) + '</h2>' +
      '<div class="s-meta">' + esc((kampan && kampan.kampan) || '') + '</div></div>' +
      '<div class="p-links"><a href="' + esc(odkaz) + '" target="_blank" rel="noopener">' + esc(odkaz) + '</a>' +
      (k.kampanData ? '<a href="/interne/kreativy/#' + esc(k.slug) + '">Upraviť kreatívy</a>' : '') + '</div></div>' +
      '<div class="s-stats"><span class="s-stat ok"><span class="n">' + ok + '</span><span class="l">schválené</span></span>' +
      '<span class="s-stat uprava"><span class="n">' + up + '</span><span class="l">na úpravu</span></span>' +
      '<span class="s-stat caka"><span class="n">' + (varianty.length - ok - up) + '</span><span class="l">čaká</span></span></div>' +
      '<div class="p-table"><table><thead><tr><th>Variant</th><th>Stav</th><th>Poznámka</th><th>Kto</th><th>Kedy</th></tr></thead><tbody>' + riadky + '</tbody></table></div></article>';
  }

  function nacitaj(heslo) {
    $('sprava').textContent = 'Načítavam…'; $('sprava').classList.remove('chyba');
    fetch('/api/schvalovanie/prehlad', { headers: { 'x-heslo': heslo }, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.chyba || 'Chyba'); return j; }); })
      .then(function (j) {
        ss('mnk-tim-heslo', heslo);
        return Promise.all(j.klienti.map(function (k) {
          if (k.kampanData) return k.kampanData;
          return fetch('/schvalovanie/' + k.slug + '/kampan.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        })).then(function (kampane) {
          $('login').hidden = true; $('odhlasit').hidden = false; $('zoznam').hidden = false;
          $('zoznam').innerHTML = j.klienti.length ? j.klienti.map(function (k, i) { return klientHTML(k, kampane[i]); }).join('') : '<div class="s-empty"><h2 class="bb">Zatiaľ žiadni klienti</h2></div>';
        });
      })
      .catch(function (e) { ss('mnk-tim-heslo', null); $('login').hidden = false; $('sprava').textContent = e.message; $('sprava').classList.add('chyba'); });
  }

  $('login').addEventListener('submit', function (e) { e.preventDefault(); nacitaj($('heslo').value); });
  $('odhlasit').addEventListener('click', function () { ss('mnk-tim-heslo', null); location.reload(); });
  var ulozene = ss('mnk-tim-heslo'); if (ulozene) nacitaj(ulozene);
})();
