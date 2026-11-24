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
  var KUS = 4 * 1024 * 1024; // musí sedieť s KUS v netlify/functions/plan.mjs
  var MAX_STRANA = 2400;     // väčšie fotky sa pri nahrávaní zmenšia
  var s = { token: '', ja: null, klienti: [], posty: [], mesiac: '', timHeslo: '', post: null, media: [], nahrava: 0, nahladSiet: 'ig' };

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  var tt;
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, 3200); }
  function sprava(t, chyba) { $('sprava').textContent = t || ''; $('sprava').classList.toggle('chyba', !!chyba); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dnes() { return iso(new Date()); }
  function kedy(x) { try { return new Date(x).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  function jeVideo(f) { return /\.(mp4|webm|mov)$/i.test(f); }
  function nahodne(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function api(method, path, body, extra) {
    var o = { method: method, headers: {}, cache: 'no-store' };
    if (s.token) o.headers.Authorization = 'Bearer ' + s.token;
    if (extra) Object.keys(extra).forEach(function (k) { o.headers[k] = extra[k]; });
    if (body instanceof Blob) o.body = body;
    else if (body !== undefined) { o.body = JSON.stringify(body); o.headers['Content-Type'] = 'application/json'; }
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
      '<span class="p-post-meta">' + (x.media && x.media[0] ? (jeVideo(x.media[0]) ? '<video class="p-post-img" src="' + esc(x.media[0]) + '#t=0.1" muted preload="metadata"></video>' : '<img class="p-post-img" src="' + esc(x.media[0]) + '" alt="" loading="lazy">') : '') +
      (x.cas ? '<b>' + esc(x.cas) + '</b>' : '') +
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
  fp.text.addEventListener('input', function () { znaky(); kresliNahlad(); });
  fp.typ.addEventListener('change', kresliNahlad);
  $('post-siete').addEventListener('change', kresliNahlad);
  fp.klient.addEventListener('change', function () {
    var k = klient(fp.klient.value);
    kampaneKlienta(k, '');
    sieteKlienta(k, k ? k.kanaly.map(function (c) { return c.siet; }) : ['ig', 'fb']);
    if (s.media.length && !confirm('Vizuály sa nahrávajú ku klientovi. Pri zmene klienta ich treba nahrať znova. Pokračovať?')) return;
    s.media = []; kresliMedia(); kresliNahlad();
  });

  function otvorPost(x, datum) {
    if (!s.klienti.length) { toast('Najprv pridajte klienta v časti Klienti a kampane.'); location.hash = 'klienti'; return; }
    s.post = x || null; s.dlg = (s.dlg || 0) + 1;
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
    s.media = x && x.media ? x.media.slice() : []; s.nahrava = 0; kresliMedia();
    znaky(); kresliNahlad();
    $('dlg-post').showModal();
    (x ? fp.text : (kid ? fp.text : fp.klient)).focus();
  }
  $('post-zrusit').addEventListener('click', function () { $('dlg-post').close(); });
  $('dlg-post').addEventListener('close', function () { s.post = null; s.dlg = (s.dlg || 0) + 1; s.nahrava = 0; $('nahlad').innerHTML = ''; });
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
    if (s.nahrava) { toast('Počkajte, kým sa nahrajú všetky vizuály.'); return; }
    data.media = s.media.slice();
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

  // ---------- vizuály ----------
  function zmensi(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.resolve(file);
    return new Promise(function (ok) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_STRANA / Math.max(w, h));
        URL.revokeObjectURL(url);
        if (k === 1 && file.size <= 1.5 * 1024 * 1024) return ok(file);
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { ok(b && b.size < file.size ? b : file); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ok(file); };
      img.src = url;
    });
  }
  function pripona(f) {
    var t = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }[f.type];
    if (t) return t;
    var m = /\.([a-z0-9]+)$/i.exec(f.name || ''), e = m ? m[1].toLowerCase() : '';
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].indexOf(e) >= 0 ? e : null;
  }
  function nahraj(kid, blob, ext, priebeh) {
    var nazov = nahodne(8) + '.' + ext, spolu = Math.max(1, Math.ceil(blob.size / KUS)), i = 0;
    var dalsi = function () {
      if (i >= spolu) return Promise.resolve('/api/plan/subor/' + kid + '/' + nazov);
      var cast = blob.slice(i * KUS, Math.min(blob.size, (i + 1) * KUS));
      return api('PUT', '/api/plan/subor?klient=' + encodeURIComponent(kid) + '&nazov=' + nazov + '&cast=' + i + '&spolu=' + spolu + '&velkost=' + blob.size, cast)
        .then(function () { i++; priebeh(Math.round(i / spolu * 100)); return dalsi(); });
    };
    return dalsi();
  }
  function kresliMedia(percent) {
    $('post-media').innerHTML = s.media.map(function (f, i) {
      return '<div class="p-m"><span class="p-m-n">' + (i + 1) + '</span>' +
        (jeVideo(f) ? '<video src="' + esc(f) + '#t=0.1" muted preload="metadata"></video>' : '<img src="' + esc(f) + '" alt="">') +
        '<div class="p-m-btns">' + (i ? '<button type="button" data-m="vlavo" data-i="' + i + '" aria-label="Posunúť dopredu">←</button>' : '') +
        (i < s.media.length - 1 ? '<button type="button" data-m="vpravo" data-i="' + i + '" aria-label="Posunúť dozadu">→</button>' : '') +
        '<button type="button" data-m="zmaz" data-i="' + i + '" aria-label="Odstrániť">×</button></div></div>';
    }).join('') + (s.nahrava ? '<div class="p-m nahrava">Nahrávam ' + s.nahrava + '…<br>' + (percent || 0) + ' %</div>' : '');
  }
  $('post-media').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m]'); if (!b) return;
    var i = Number(b.dataset.i), m = s.media;
    if (b.dataset.m === 'zmaz') m.splice(i, 1);
    if (b.dataset.m === 'vlavo') m.splice(i - 1, 0, m.splice(i, 1)[0]);
    if (b.dataset.m === 'vpravo') m.splice(i + 1, 0, m.splice(i, 1)[0]);
    kresliMedia(); kresliNahlad();
  });
  $('post-subory').addEventListener('change', function () {
    var kid = fp.klient.value, zoznam = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (!kid) { toast('Najprv vyberte klienta.'); return; }
    zoznam = zoznam.filter(function (f) { if (pripona(f)) return true; toast(f.name + ' nie je obrázok ani video.'); return false; });
    zoznam = zoznam.filter(function (f) { if (f.size <= 200 * 1024 * 1024) return true; toast(f.name + ' je väčší ako 200 MB.'); return false; });
    if (s.media.length + s.nahrava + zoznam.length > 20) { toast('Jeden post môže mať najviac 20 vizuálov.'); zoznam = zoznam.slice(0, Math.max(0, 20 - s.media.length - s.nahrava)); }
    if (!zoznam.length) return;
    s.nahrava += zoznam.length; kresliMedia(0);
    var poradie = Promise.resolve(), dlg = s.dlg;
    zoznam.forEach(function (f) {
      poradie = poradie.then(function () {
        return zmensi(f).then(function (b) {
          return nahraj(kid, b, b === f ? pripona(f) : 'jpg', function (p) { if (s.dlg === dlg) kresliMedia(p); });
        }).then(function (cesta) {
          if (s.dlg === dlg && $('dlg-post').open) { s.media.push(cesta); if (s.media.length > 1 && fp.typ.value === 'post') fp.typ.value = 'karusel'; if (jeVideo(cesta) && fp.typ.value === 'post') fp.typ.value = 'reels'; }
        }).catch(function (err) { toast('Nahrávanie ' + f.name + ' zlyhalo: ' + err.message); })
          .then(function () { s.nahrava = Math.max(0, s.nahrava - 1); kresliMedia(); kresliNahlad(); });
      });
    });
  });

  // ---------- náhľad ----------
  var IKONY = {
    srdce: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.3-8.6C1.2 8.6 2.9 5 6.4 5c2 0 3.2 1.1 3.9 2.2h3.4C14.4 6.1 15.6 5 17.6 5c3.5 0 5.2 3.6 3.7 6.4C19 15.6 12 20 12 20z"/></svg>',
    bublina: '<svg viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-4.2A8 8 0 1 1 20 11.5z"/></svg>',
    lietadlo: '<svg viewBox="0 0 24 24"><path d="M21 4 3 11l7 2 2 7 9-16zM10 13l11-9"/></svg>',
    zalozka: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-5-6 5z"/></svg>',
  };
  function vybraneSiete() { return Array.prototype.map.call(fp.querySelectorAll('[name="siet"]:checked'), function (i) { return i.value; }); }
  function ucet(siet) {
    var k = klient(fp.klient.value);
    var c = k && k.kanaly.filter(function (x) { return x.siet === siet && x.nazov; })[0];
    return c ? c.nazov : (k ? k.nazov : 'Účet klienta');
  }
  function inicialy(t) { return esc(String(t).split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase()); }
  function medium(f) { return jeVideo(f) ? '<video src="' + esc(f) + '" muted playsinline loop autoplay></video>' : '<img src="' + esc(f) + '" alt="">'; }
  function skrat(t, n, viac) { t = t || ''; return t.length > n ? esc(t.slice(0, n).replace(/\s+\S*$/, '')) + '… <span class="n-viac">' + viac + '</span>' : esc(t); }
  function nahladIg(typ, text, m) {
    var meno = ucet('ig');
    if (typ === 'story' || typ === 'reels') {
      return '<div class="n-vert">' + (m[0] ? medium(m[0]) : '<div class="n-prazdne">Bez vizuálu</div>') +
        (typ === 'story' ? '<div class="n-bar">' + (m.length > 1 ? m.map(function () { return '<i></i>'; }).join('') : '<i></i>') + '</div>' : '') +
        '<div class="n-vert-hd"><span class="n-av">' + inicialy(meno) + '</span><b>' + esc(meno) + '</b></div>' +
        (typ === 'reels' ? '<div class="n-vert-ft"><b>' + esc(meno) + '</b>' + skrat(text, 90, 'viac') + '</div>' : '') + '</div>';
    }
    return '<div class="n"><div class="n-hd"><span class="n-av">' + inicialy(meno) + '</span><b>' + esc(meno) + '</b></div>' +
      (typ === 'text' ? '' : '<div class="n-med">' + (m[0] ? medium(m[0]) : '<div class="n-prazdne">Bez vizuálu</div>') +
        (m.length > 1 ? '<span class="n-cnt">1/' + m.length + '</span>' : '') + '</div>' +
        (m.length > 1 ? '<div class="n-dots">' + m.slice(0, 10).map(function () { return '<i></i>'; }).join('') + '</div>' : '')) +
      '<div class="n-akc">' + IKONY.srdce + IKONY.bublina + IKONY.lietadlo + '<span class="n-save">' + IKONY.zalozka + '</span></div>' +
      '<div class="n-txt"><b>' + esc(meno) + '</b> ' + skrat(text, 125, 'viac') + '</div></div>';
  }
  function nahladFb(typ, text, m, siet) {
    var meno = ucet(siet), li = siet === 'linkedin';
    var obr = '';
    if (m.length === 1) obr = '<div class="n-med ' + (jeVideo(m[0]) && typ !== 'reels' ? 'r169' : typ === 'reels' || typ === 'story' ? 'r916' : '') + '">' + medium(m[0]) + '</div>';
    else if (m.length > 1) obr = '<div class="n-grid">' + m.slice(0, 4).map(function (f, i) {
      return '<div>' + medium(f) + (i === 3 && m.length > 4 ? '<span class="n-plus">+' + (m.length - 4) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
    return '<div class="n"><div class="n-hd' + (li ? ' n-li-hd' : '') + '"><span class="n-av">' + inicialy(meno) + '</span><span><b>' + esc(meno) + '</b><small>' + (li ? 'Sledovatelia · Teraz' : 'Teraz · Verejné') + '</small></span></div>' +
      '<div class="n-fb-txt">' + skrat(text, li ? 210 : 480, li ? '…viac' : 'Zobraziť viac') + '</div>' + (typ === 'text' ? '' : obr) +
      '<div class="n-fb-akc"><span>' + (li ? 'Páči sa mi to' : 'Páči sa mi to') + '</span><span>Komentovať</span><span>' + (li ? 'Preposlať' : 'Zdieľať') + '</span></div></div>';
  }
  function nahladTt(text, m) {
    var meno = ucet('tiktok');
    return '<div class="n-vert">' + (m[0] ? medium(m[0]) : '<div class="n-prazdne">Bez videa</div>') +
      '<div class="n-vert-ft"><b>@' + esc(meno.replace(/\s+/g, '').toLowerCase()) + '</b>' + skrat(text, 100, 'viac') + '</div></div>';
  }
  function kresliNahlad() {
    var siete = vybraneSiete();
    if (siete.indexOf(s.nahladSiet) < 0) s.nahladSiet = siete[0] || '';
    $('nahlad-tabs').innerHTML = siete.map(function (n) {
      return '<button type="button" role="tab" data-siet="' + n + '" aria-selected="' + (n === s.nahladSiet) + '">' + SIETE[n] + '</button>';
    }).join('');
    var typ = fp.typ.value, text = fp.text.value, m = s.media, n = s.nahladSiet;
    $('nahlad').innerHTML = !n ? '<p class="e-hint">Vyberte sieť.</p>'
      : n === 'ig' ? nahladIg(typ, text, m)
      : n === 'tiktok' ? nahladTt(text, m)
      : nahladFb(typ, text, m, n);
  }
  $('nahlad-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-siet]'); if (!b) return; s.nahladSiet = b.dataset.siet; kresliNahlad();
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
