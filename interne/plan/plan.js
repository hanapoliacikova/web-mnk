/* MNK Plán: kalendár postov pre tím. Dáta cez /api/plan (netlify/functions/plan.mjs). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SIETE = { ig: 'Instagram', fb: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn' };
  var SKRATKY = { ig: 'IG', fb: 'FB', tiktok: 'TT', linkedin: 'IN' };
  var STAVY = { koncept: 'Koncept', interna: 'Interná kontrola', klient: 'U klienta', uprava: 'Na úpravu', schvalene: 'Schválené', zverejnene: 'Zverejnené' };
  var MESIACE = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];
  var DNI = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];
  var DNI_CELE = ['pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota', 'nedeľa'];
  var s = { token: '', ja: null, klienti: [], posty: [], mesiac: '', timHeslo: '', post: null };

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  var tt;
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, 3200); }
  function sprava(t, chyba) { $('sprava').textContent = t || ''; $('sprava').classList.toggle('chyba', !!chyba); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dnes() { return iso(new Date()); }
  function kedy(x) { try { return new Date(x).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  function api(method, path, body, extra) {
    var o = { method: method, headers: {}, cache: 'no-store' };
    if (s.token) o.headers.Authorization = 'Bearer ' + s.token;
    if (extra) Object.keys(extra).forEach(function (k) { o.headers[k] = extra[k]; });
    if (body !== undefined) { o.body = JSON.stringify(body); o.headers['Content-Type'] = 'application/json'; }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path.indexOf('/api/plan/prihlasit') !== 0) { odhlas('Prihlásenie vypršalo, prihláste sa znova.'); }
        if (!r.ok) { var e = new Error(j.chyba || ('Chyba ' + r.status)); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }

  // ---------- prihlásenie ----------
  function odhlas(msg) {
    ls('mnk-plan-token', null); s.token = ''; s.ja = null;
    $('nav').hidden = true;
    ['v-kalendar', 'v-klienti'].forEach(function (id) { $(id).hidden = true; });
    if (location.hash === '#tim') { route(); } else { $('v-tim').hidden = true; $('login').hidden = false; }
    $('login-msg').textContent = msg || ''; $('login-msg').classList.toggle('chyba', !!msg);
  }
  function prihlaseny(ja) {
    s.ja = ja; $('ja').textContent = ja.meno; $('nav').hidden = false; $('login').hidden = true;
    return nacitajKlientov().then(route);
  }
  $('login').addEventListener('submit', function (e) {
    e.preventDefault();
    api('POST', '/api/plan/prihlasit', { login: $('l-login').value, heslo: $('l-heslo').value })
      .then(function (j) { s.token = j.token; ls('mnk-plan-token', j.token); $('l-heslo').value = ''; return prihlaseny(j.ja); })
      .catch(function (err) { $('login-msg').textContent = err.message; $('login-msg').classList.add('chyba'); });
  });
  $('odhlasit').addEventListener('click', function () { api('POST', '/api/plan/odhlasit').catch(function () {}).then(function () { odhlas(''); }); });
  $('zmena-hesla').addEventListener('click', function () { $('f-heslo').reset(); $('dlg-heslo').showModal(); });
  $('f-heslo').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target;
    api('POST', '/api/plan/heslo', { stare: f.stare.value, nove: f.nove.value })
      .then(function () { $('dlg-heslo').close(); toast('Heslo je zmenené.'); })
      .catch(function (err) { toast(err.message); });
  });
  document.querySelectorAll('[data-zavriet]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });

  // ---------- smerovanie ----------
  function route() {
    var v = (location.hash || '#kalendar').slice(1);
    if (!/^(kalendar|klienti|tim)$/.test(v)) v = 'kalendar';
    if (!s.ja && v !== 'tim') { $('login').hidden = false; return; }
    $('login').hidden = true;
    ['kalendar', 'klienti', 'tim'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    document.querySelectorAll('#nav a').forEach(function (a) { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    sprava('');
    if (v === 'kalendar') kalendar();
    if (v === 'klienti') kresliKlientov();
    if (v === 'tim') tim();
  }
  window.addEventListener('hashchange', route);

  // ---------- klienti ----------
  function nacitajKlientov() {
    return api('GET', '/api/plan/klienti').then(function (j) { s.klienti = j.klienti; filtre(); });
  }
  function klient(id) { return s.klienti.filter(function (k) { return k.id === id; })[0]; }
  function kampan(k, id) { return k ? k.kampane.filter(function (c) { return c.id === id; })[0] : null; }

  function moznosti(zoznam, vybrane, prazdna) {
    return (prazdna ? '<option value="">' + esc(prazdna) + '</option>' : '') + zoznam.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === vybrane ? ' selected' : '') + '>' + esc(x.nazov) + '</option>';
    }).join('');
  }
  function filtre() {
    var fk = ls('mnk-plan-klient') || '';
    if (fk && !klient(fk)) fk = '';
    $('f-klient').innerHTML = moznosti(s.klienti, fk, 'Všetci klienti');
    var k = klient(fk), fc = ls('mnk-plan-kampan') || '';
    $('f-kampan').innerHTML = moznosti(k ? k.kampane.filter(function (c) { return !c.archiv; }) : [], fc, 'Všetky kampane');
    $('f-kampan').disabled = !k;
  }
  $('f-klient').addEventListener('change', function () { ls('mnk-plan-klient', this.value); ls('mnk-plan-kampan', ''); filtre(); kalendar(); });
  $('f-kampan').addEventListener('change', function () { ls('mnk-plan-kampan', this.value); kresliKalendar(); });

  $('novy-klient').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target;
    api('POST', '/api/plan/klienti', { nazov: f.nazov.value }).then(function (j) {
      f.reset(); s.klienti.push(j.klient); s.klienti.sort(function (a, b) { return a.nazov.localeCompare(b.nazov, 'sk'); });
      filtre(); kresliKlientov(j.klient.id);
    }).catch(function (err) { toast(err.message); });
  });

  function riadokKanal(c) {
    return '<div class="p-riadok" data-id="' + esc(c.id || '') + '"><select data-f="siet">' +
      Object.keys(SIETE).map(function (k) { return '<option value="' + k + '"' + (c.siet === k ? ' selected' : '') + '>' + SIETE[k] + '</option>'; }).join('') +
      '</select><input type="text" data-f="nazov" maxlength="80" placeholder="Názov účtu, napr. CinemArt SK" value="' + esc(c.nazov) + '">' +
      '<button class="p-x" type="button" data-zmaz aria-label="Odstrániť">×</button></div>';
  }
  function riadokKampan(c) {
    return '<div class="p-riadok" data-id="' + esc(c.id || '') + '"><input type="color" data-f="farba" value="' + esc(c.farba || '#2B988F') + '" aria-label="Farba v kalendári">' +
      '<input type="text" data-f="nazov" maxlength="120" placeholder="Napr. DILEMA" value="' + esc(c.nazov) + '">' +
      '<label><input type="checkbox" data-f="archiv"' + (c.archiv ? ' checked' : '') + '> skončená</label>' +
      '<button class="p-x" type="button" data-zmaz aria-label="Odstrániť">×</button></div>';
  }
  function kresliKlientov(otvorit) {
    var el = $('klienti');
    if (!s.klienti.length) { el.innerHTML = '<div class="s-empty"><h2 class="bb">Zatiaľ žiadni klienti</h2>Pridajte prvého hore.</div>'; return; }
    el.innerHTML = s.klienti.map(function (k) {
      return '<form class="p-card p-klient" data-id="' + esc(k.id) + '">' +
        '<div class="p-klient-hd"><label class="e-f"><span class="lbl">Klient</span><input name="nazov" maxlength="120" required value="' + esc(k.nazov) + '"></label></div>' +
        '<div class="p-cols"><div><h4>Účty na sieťach</h4><div data-zoznam="kanaly">' + k.kanaly.map(riadokKanal).join('') + '</div>' +
        '<button class="btn link" type="button" data-pridaj="kanaly">+ Pridať účet</button></div>' +
        '<div><h4>Kampane (napr. filmy)</h4><div data-zoznam="kampane">' + k.kampane.map(riadokKampan).join('') + '</div>' +
        '<button class="btn link" type="button" data-pridaj="kampane">+ Pridať kampaň</button></div></div>' +
        '<div class="p-klient-btns"><button class="btn primary" type="submit">Uložiť</button>' +
        '<span class="e-hint" style="margin:0">Upravené ' + esc(kedy(k.upravene)) + '</span><span class="p-grow"></span>' +
        '<button class="btn link" type="button" data-zmaz-klienta>Zmazať klienta</button></div></form>';
    }).join('');
    if (otvorit) { var f = el.querySelector('[data-id="' + otvorit + '"]'); if (f) { f.scrollIntoView({ block: 'center' }); f.nazov.focus(); } }
  }
  $('klienti').addEventListener('click', function (e) {
    var t = e.target, f = t.closest('form');
    if (t.matches('[data-zmaz]')) t.closest('.p-riadok').remove();
    if (t.matches('[data-pridaj]')) {
      var z = f.querySelector('[data-zoznam="' + t.dataset.pridaj + '"]');
      z.insertAdjacentHTML('beforeend', t.dataset.pridaj === 'kanaly' ? riadokKanal({ siet: 'ig', nazov: '' }) : riadokKampan({ nazov: '', farba: '#2B988F' }));
      z.lastElementChild.querySelector('input[type="text"]').focus();
    }
    if (t.matches('[data-zmaz-klienta]')) {
      var k = klient(f.dataset.id);
      if (!confirm('Zmazať klienta ' + k.nazov + ' aj so všetkými jeho postami? Toto sa nedá vrátiť.')) return;
      api('DELETE', '/api/plan/klienti?id=' + encodeURIComponent(k.id)).then(function () {
        s.klienti = s.klienti.filter(function (x) { return x.id !== k.id; }); filtre(); kresliKlientov(); toast('Klient je zmazaný.');
      }).catch(function (err) { toast(err.message); });
    }
  });
  $('klienti').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target, k = klient(f.dataset.id);
    var citaj = function (zoznam) {
      return Array.prototype.map.call(f.querySelectorAll('[data-zoznam="' + zoznam + '"] .p-riadok'), function (r) {
        var o = { id: r.dataset.id || undefined };
        r.querySelectorAll('[data-f]').forEach(function (i) { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; });
        return o;
      });
    };
    var data = { nazov: f.nazov.value, farba: k.farba, kanaly: citaj('kanaly'), kampane: citaj('kampane'), upravene: k.upravene };
    api('PUT', '/api/plan/klienti?id=' + encodeURIComponent(k.id), data).then(function (j) {
      s.klienti = s.klienti.map(function (x) { return x.id === k.id ? j.klient : x; });
      filtre(); kresliKlientov(); toast('Uložené.');
    }).catch(function (err) { toast(err.message); });
  });

  // ---------- kalendár ----------
  function nastavMesiac(m) { s.mesiac = m; ls('mnk-plan-mesiac', m); }
  function posunMesiac(o) {
    var p = s.mesiac.split('-').map(Number), d = new Date(p[0], p[1] - 1 + o, 1);
    nastavMesiac(d.getFullYear() + '-' + pad(d.getMonth() + 1)); kalendar();
  }
  $('m-pred').addEventListener('click', function () { posunMesiac(-1); });
  $('m-dalsi').addEventListener('click', function () { posunMesiac(1); });
  $('m-dnes').addEventListener('click', function () { nastavMesiac(dnes().slice(0, 7)); kalendar(); });

  function kalendar() {
    if (!s.mesiac) nastavMesiac(ls('mnk-plan-mesiac') || dnes().slice(0, 7));
    var p = s.mesiac.split('-').map(Number);
    $('m-nazov').textContent = MESIACE[p[1] - 1] + ' ' + p[0];
    var fk = $('f-klient').value, mes = s.mesiac;
    sprava('Načítavam…');
    return api('GET', '/api/plan/posty?mesiac=' + mes + (fk ? '&klient=' + encodeURIComponent(fk) : '')).then(function (j) {
      if (mes !== s.mesiac) return;
      s.posty = j.posty; sprava(''); kresliKalendar();
    }).catch(function (err) { sprava(err.message, true); });
  }

  function kresliKalendar() {
    var p = s.mesiac.split('-').map(Number);
    var prvy = new Date(p[0], p[1] - 1, 1), posun = (prvy.getDay() + 6) % 7;
    var start = new Date(p[0], p[1] - 1, 1 - posun);
    var pocetDni = new Date(p[0], p[1], 0).getDate();
    var tyzdne = Math.ceil((posun + pocetDni) / 7);
    var fc = $('f-kampan').value, dnesD = dnes();
    var posty = s.posty.filter(function (x) { return !fc || x.kampan === fc; });
    var poDnoch = {};
    posty.forEach(function (x) { (poDnoch[x.datum] = poDnoch[x.datum] || []).push(x); });
    var html = DNI.map(function (d) { return '<div class="p-hd">' + d + '</div>'; }).join('');
    for (var i = 0; i < tyzdne * 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), di = iso(d);
      var mimo = d.getMonth() !== p[1] - 1, zoz = poDnoch[di] || [];
      html += '<div class="p-den' + (mimo ? ' mimo' : '') + (di === dnesD ? ' dnes' : '') + (zoz.length ? '' : ' prazdny') + '" data-datum="' + di + '">' +
        '<div class="p-den-hd"><span class="p-cislo">' + d.getDate() + '</span><span class="p-den-nazov">' + DNI_CELE[(d.getDay() + 6) % 7] + '</span>' +
        '<button class="p-plus" type="button" data-novy="' + di + '" aria-label="Nový post ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.">+</button></div>' +
        zoz.map(chip).join('') + '</div>';
    }
    if (!posty.length) html += '<div class="s-empty p-prazdny-mobil">V tomto mesiaci zatiaľ nie sú žiadne posty.</div>';
    $('kal').innerHTML = html;
  }
  function chip(x) {
    var k = klient(x.klient), c = kampan(k, x.kampan);
    var farba = (c && c.farba) || (k && k.farba) || '#226D6E';
    var titul = x.nazov || (x.text || '').split('\n')[0] || 'Bez textu';
    var popis = [k && !$('f-klient').value ? k.nazov : '', c ? c.nazov : ''].filter(Boolean).join(' · ');
    return '<button class="p-post" type="button" draggable="true" data-post="' + esc(x.id) + '" style="--farba:' + esc(farba) + '">' +
      '<span class="p-post-meta">' + (x.cas ? '<b>' + esc(x.cas) + '</b>' : '') +
      x.kanaly.map(function (n) { return '<span class="p-s ' + n + '">' + SKRATKY[n] + '</span>'; }).join('') + '</span>' +
      '<span class="p-post-t">' + esc(titul) + '</span>' + (popis ? '<span class="p-post-k">' + esc(popis) + '</span>' : '') + '</button>';
  }

  $('kal').addEventListener('click', function (e) {
    var b = e.target.closest('[data-post]');
    if (b) { otvorPost(s.posty.filter(function (x) { return x.id === b.dataset.post; })[0]); return; }
    var den = e.target.closest('[data-datum]');
    if (den) otvorPost(null, den.dataset.datum);
  });
  $('novy-post').addEventListener('click', function () {
    var d = dnes(); otvorPost(null, d.slice(0, 7) === s.mesiac ? d : s.mesiac + '-01');
  });

  // presun potiahnutím
  var tahany = null;
  $('kal').addEventListener('dragstart', function (e) {
    var b = e.target.closest('[data-post]'); if (!b) return;
    tahany = b.dataset.post; b.classList.add('tahany');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tahany);
  });
  $('kal').addEventListener('dragend', function (e) { var b = e.target.closest('[data-post]'); if (b) b.classList.remove('tahany'); });
  $('kal').addEventListener('dragover', function (e) {
    var den = e.target.closest('[data-datum]'); if (!den || !tahany) return;
    e.preventDefault(); document.querySelectorAll('.p-den.ciel').forEach(function (x) { if (x !== den) x.classList.remove('ciel'); }); den.classList.add('ciel');
  });
  $('kal').addEventListener('dragleave', function (e) { var den = e.target.closest('[data-datum]'); if (den && !den.contains(e.relatedTarget)) den.classList.remove('ciel'); });
  $('kal').addEventListener('drop', function (e) {
    var den = e.target.closest('[data-datum]'); if (!den || !tahany) return;
    e.preventDefault(); den.classList.remove('ciel');
    var x = s.posty.filter(function (p) { return p.id === tahany; })[0]; tahany = null;
    if (!x || x.datum === den.dataset.datum) return;
    var novy = Object.assign({}, x, { datum: den.dataset.datum });
    x.datum = novy.datum; kresliKalendar();
    api('PUT', '/api/plan/posty?klient=' + encodeURIComponent(x.klient) + '&id=' + encodeURIComponent(x.id), novy)
      .then(function () { toast('Presunuté na ' + den.dataset.datum.split('-').reverse().join('.') + '.'); kalendar(); })
      .catch(function (err) { toast(err.message); kalendar(); });
  });

  // ---------- dialóg postu ----------
  var fp = $('f-post');
  function sieteKlienta(k, vybrane) {
    var mozne = Object.keys(SIETE);
    $('post-siete').innerHTML = mozne.map(function (n) {
      var ucet = k ? k.kanaly.filter(function (c) { return c.siet === n; }).map(function (c) { return c.nazov; }).filter(Boolean).join(', ') : '';
      return '<label><input type="checkbox" name="siet" value="' + n + '"' + (vybrane.indexOf(n) >= 0 ? ' checked' : '') + '> ' + SIETE[n] +
        (ucet ? '<small style="color:var(--seda)">' + esc(ucet) + '</small>' : '') + '</label>';
    }).join('');
  }
  function kampaneKlienta(k, vybrana) {
    fp.kampan.innerHTML = moznosti(k ? k.kampane.filter(function (c) { return !c.archiv || c.id === vybrana; }) : [], vybrana, 'Bez kampane');
  }
  function znaky() { var n = fp.text.value.length; $('post-znaky').textContent = n + ' znakov' + (n > 2200 ? ', Instagram zobrazí najviac 2 200' : ''); }
  fp.text.addEventListener('input', znaky);
  fp.klient.addEventListener('change', function () {
    var k = klient(fp.klient.value);
    kampaneKlienta(k, '');
    sieteKlienta(k, k ? k.kanaly.map(function (c) { return c.siet; }) : ['ig', 'fb']);
  });

  function otvorPost(x, datum) {
    if (!s.klienti.length) { toast('Najprv pridajte klienta v časti Klienti a kampane.'); location.hash = 'klienti'; return; }
    s.post = x || null;
    var kid = x ? x.klient : ($('f-klient').value || (s.klienti.length === 1 ? s.klienti[0].id : ''));
    var k = klient(kid);
    fp.reset();
    fp.klient.innerHTML = moznosti(s.klienti, kid, kid ? '' : 'Vyberte klienta');
    fp.klient.disabled = !!x;
    kampaneKlienta(k, x ? x.kampan : $('f-kampan').value);
    sieteKlienta(k, x ? x.kanaly : (k && k.kanaly.length ? k.kanaly.map(function (c) { return c.siet; }) : ['ig', 'fb']));
    fp.datum.value = x ? x.datum : datum;
    fp.cas.value = x ? x.cas : '';
    fp.typ.value = x ? x.typ : 'post';
    fp.nazov.value = x ? x.nazov : '';
    fp.text.value = x ? x.text : '';
    fp.poznamka.value = x ? x.poznamka : '';
    $('post-titul').textContent = x ? 'Upraviť post' : 'Nový post';
    $('post-stav').textContent = STAVY[x ? x.stav : 'koncept'];
    $('post-info').textContent = x ? 'Pripravil(a) ' + x.autor + ', naposledy upravil(a) ' + x.upravil + ' ' + kedy(x.upravene) + '.' : '';
    $('post-zmazat').hidden = !x;
    znaky();
    $('dlg-post').showModal();
    (x ? fp.text : (kid ? fp.text : fp.klient)).focus();
  }
  $('post-zrusit').addEventListener('click', function () { $('dlg-post').close(); });
  fp.addEventListener('submit', function (e) {
    e.preventDefault();
    var x = s.post;
    var data = {
      klient: fp.klient.value, kampan: fp.kampan.value, datum: fp.datum.value, cas: fp.cas.value, typ: fp.typ.value,
      kanaly: Array.prototype.map.call(fp.querySelectorAll('[name="siet"]:checked'), function (i) { return i.value; }),
      nazov: fp.nazov.value, text: fp.text.value, poznamka: fp.poznamka.value,
    };
    if (!data.klient) { toast('Vyberte klienta.'); return; }
    if (!data.kanaly.length) { toast('Vyberte aspoň jednu sieť.'); return; }
    var req = x
      ? api('PUT', '/api/plan/posty?klient=' + encodeURIComponent(x.klient) + '&id=' + encodeURIComponent(x.id), Object.assign(data, { upravene: x.upravene }))
      : api('POST', '/api/plan/posty', data);
    $('post-ulozit').disabled = true;
    req.then(function (j) {
      $('dlg-post').close(); toast('Uložené.');
      var m = j.post.datum.slice(0, 7);
      if (m !== s.mesiac) { nastavMesiac(m); }
      kalendar();
    }).catch(function (err) { toast(err.message); }).then(function () { $('post-ulozit').disabled = false; });
  });
  $('post-zmazat').addEventListener('click', function () {
    var x = s.post; if (!x || !confirm('Zmazať tento post?')) return;
    api('DELETE', '/api/plan/posty?klient=' + encodeURIComponent(x.klient) + '&id=' + encodeURIComponent(x.id))
      .then(function () { $('dlg-post').close(); toast('Post je zmazaný.'); kalendar(); })
      .catch(function (err) { toast(err.message); });
  });

  // ---------- tím (správa účtov heslom tímu) ----------
  function tim() {
    if (!s.timHeslo) { $('tim-login').hidden = false; $('tim').hidden = true; return; }
    api('GET', '/api/plan/tim', undefined, { 'x-heslo': s.timHeslo }).then(function (j) {
      $('tim-login').hidden = true; $('tim').hidden = false;
      $('ludia').innerHTML = j.ludia.length ? j.ludia.map(function (u) {
        return '<div class="p-card p-clovek' + (u.aktivny ? '' : ' neaktivny') + '" data-login="' + esc(u.login) + '"><b>' + esc(u.meno) + '</b>' +
          '<span class="e-hint" style="margin:0">prihlasovacie meno: ' + esc(u.login) + (u.aktivny ? '' : ', vypnutý') + '</span>' +
          '<div class="p-klient-btns" style="margin-top:4px"><button class="btn link" type="button" data-reset>Nastaviť nové heslo</button>' +
          '<button class="btn link" type="button" data-aktivny="' + (u.aktivny ? '0' : '1') + '">' + (u.aktivny ? 'Vypnúť účet' : 'Zapnúť účet') + '</button></div></div>';
      }).join('') : '<div class="s-empty"><h2 class="bb">Zatiaľ nikto</h2>Založte účty pre tím hore.</div>';
    }).catch(function (err) {
      if (err.status === 403) { s.timHeslo = ''; $('tim-login').hidden = false; $('tim').hidden = true; }
      sprava(err.message, true);
    });
  }
  $('tim-login').addEventListener('submit', function (e) { e.preventDefault(); s.timHeslo = $('tim-heslo').value; $('tim-heslo').value = ''; tim(); });
  $('novy-clovek').addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target;
    api('POST', '/api/plan/tim', { meno: f.meno.value, login: f.login.value, heslo: f.heslo.value }, { 'x-heslo': s.timHeslo })
      .then(function (j) { f.reset(); toast('Účet ' + j.clovek.login + ' je založený.'); tim(); })
      .catch(function (err) { toast(err.message); });
  });
  $('novy-clovek').meno.addEventListener('input', function () {
    var f = $('novy-clovek'); if (f.login.dataset.rucne) return;
    f.login.value = f.meno.value.split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  });
  $('novy-clovek').login.addEventListener('input', function () { this.dataset.rucne = '1'; });
  $('ludia').addEventListener('click', function (e) {
    var t = e.target, c = t.closest('[data-login]'); if (!c) return;
    var login = c.dataset.login, body = null;
    if (t.matches('[data-reset]')) {
      var h = prompt('Nové heslo pre ' + login + ' (aspoň 8 znakov):'); if (!h) return; body = { heslo: h };
    } else if (t.matches('[data-aktivny]')) body = { aktivny: t.dataset.aktivny === '1' };
    if (!body) return;
    api('PUT', '/api/plan/tim?login=' + encodeURIComponent(login), body, { 'x-heslo': s.timHeslo })
      .then(function () { toast('Uložené.'); tim(); }).catch(function (err) { toast(err.message); });
  });

  // ---------- štart ----------
  s.token = ls('mnk-plan-token') || '';
  if (s.token) {
    api('GET', '/api/plan/ja').then(function (j) { return prihlaseny(j.ja); }).catch(function (err) { if (err.status !== 401) sprava(err.message, true); });
  } else odhlas('');
})();
