/* Nahrávanie kreatív na schválenie (pre tím MNK). Heslo = premenná TIM_HESLO v Netlify.
   Kampane a súbory ukladá /api/kreativy do Netlify Blobs. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KUS = 4 * 1024 * 1024; // musí sedieť s KUS v netlify/functions/kreativy.mjs
  var MAX_STRANA = 2400;     // obrázky väčšie ako toto sa zmenšia
  var NAZVY = { schvalene: 'Schválené', uprava: 'Na úpravu', caka: 'Čaká' };
  var s = { heslo: '', kampan: null, stav: {}, dirty: false, nahrava: 0, ukladam: false };

  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function datum(iso) { try { return new Date(iso).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  var tt;
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(function () { el.hidden = true; }, 3000); }
  function sprava(t, chyba) { $('sprava').textContent = t || ''; $('sprava').classList.toggle('chyba', !!chyba); }
  function nahodne(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function odkaz(slug) { return location.origin + '/schvalovanie/' + slug + '/'; }
  function jeVideo(f) { return /\.(mp4|webm|mov)$/i.test(f); }

  function api(method, path, body, raw) {
    var o = { method: method, headers: { 'x-heslo': s.heslo }, cache: 'no-store' };
    if (body !== undefined) { o.body = raw ? body : JSON.stringify(body); if (!raw) o.headers['Content-Type'] = 'application/json'; }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { odhlas('Nesprávne heslo.'); throw new Error('Nesprávne heslo.'); }
        if (!r.ok) { var e = new Error(j.chyba || ('Chyba ' + r.status)); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    });
  }

  // ---------- prihlásenie ----------
  function odhlas(msg) {
    ss('mnk-tim-heslo', null); s.heslo = '';
    $('login').hidden = false; $('zoznam').hidden = true; $('editor').hidden = true; $('bar').hidden = true; $('odhlasit').hidden = true;
    $('login-msg').textContent = msg || ''; $('login-msg').classList.toggle('chyba', !!msg);
  }
  $('login').addEventListener('submit', function (e) {
    e.preventDefault(); s.heslo = $('heslo').value;
    api('GET', '/api/kreativy').then(function (j) { ss('mnk-tim-heslo', s.heslo); $('login').hidden = true; $('odhlasit').hidden = false; route(j); })
      .catch(function (err) { if (s.heslo) odhlas(err.message); });
  });
  $('odhlasit').addEventListener('click', function () { if (!opustit()) return; odhlas(''); });

  // ---------- zoznam ----------
  function zoznam(j) {
    $('titul').textContent = 'Kreatívy na schválenie';
    $('zoznam').hidden = false; $('editor').hidden = true; $('bar').hidden = true; s.kampan = null;
    var render = function (kampane) {
      $('kampane').innerHTML = kampane.length ? kampane.map(function (k) {
        var subory = [];
        k.varianty.forEach(function (v) { if (v.obrazky[0]) subory.push(v.obrazky[0]); });
        return '<a class="e-card" href="#' + esc(k.slug) + '"><h3>' + esc(k.klient) + '</h3>' +
          '<span>' + esc(k.kampan || 'Bez názvu kampane') + '</span>' +
          '<div class="e-thumbs">' + subory.slice(0, 6).map(function (f) { return jeVideo(f) ? '<video src="' + esc(f) + '#t=0.1" muted preload="metadata"></video>' : '<img src="' + esc(f) + '" alt="" loading="lazy">'; }).join('') + '</div>' +
          '<small>' + k.varianty.length + ' ' + (k.varianty.length === 1 ? 'variant' : k.varianty.length < 5 && k.varianty.length ? 'varianty' : 'variantov') + ', upravené ' + esc(datum(k.upravene)) + '</small></a>';
      }).join('') : '<div class="s-empty"><h2 class="bb">Zatiaľ žiadne kampane</h2>Založte prvú hore.</div>';
    };
    if (j) render(j.kampane); else api('GET', '/api/kreativy').then(function (r) { render(r.kampane); }).catch(function (e) { sprava(e.message, true); });
  }
  $('nova').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button'); btn.disabled = true;
    api('POST', '/api/kreativy', { klient: f.klient.value, kampan: f.kampan.value })
      .then(function (j) { f.reset(); location.hash = j.kampan.slug; })
      .catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; });
  });

  // ---------- editor ----------
  function otvor(slug) {
    sprava('Načítavam…');
    Promise.all([
      fetch('/api/kreativy/kampan?klient=' + encodeURIComponent(slug), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Kampaň sa nenašla.'); return r.json(); }),
      fetch('/api/schvalovanie?klient=' + encodeURIComponent(slug), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { stav: {} }; }),
    ]).then(function (r) {
      sprava('');
      s.kampan = r[0]; s.stav = r[1].stav || {}; nastavDirty(false);
      $('zoznam').hidden = true; $('editor').hidden = false; $('bar').hidden = false;
      document.querySelectorAll('[data-k]').forEach(function (el) { el.value = s.kampan[el.dataset.k] || ''; });
      hlavicka(); kresli(); window.scrollTo(0, 0);
    }).catch(function (e) { sprava(e.message, true); zoznam(); });
  }
  function hlavicka() {
    var k = s.kampan;
    $('titul').textContent = k.klient + (k.kampan ? ': ' + k.kampan : '');
    var url = odkaz(k.slug);
    $('odkaz').innerHTML = '<span class="lbl">Odkaz pre klienta</span><code>' + esc(url) + '</code>' +
      '<button class="btn" type="button" data-a="kopirovat">Kopírovať</button><a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">Otvoriť ako klient</a>';
  }

  function variantHTML(v, i, n) {
    var z = s.stav[v.id] || {}; var st = z.status || 'caka';
    var subory = v.obrazky.map(function (f, j) {
      var m = jeVideo(f) ? '<video src="' + esc(f) + '#t=0.1" muted preload="metadata" playsinline></video>' : '<img src="' + esc(f) + '" alt="">';
      return '<div class="e-file">' + m + (v.obrazky.length > 1 ? '<span class="e-num">' + (j + 1) + '</span>' : '') +
        '<div class="e-fbtns">' + (j > 0 ? '<button type="button" data-a="f-vlavo" data-j="' + j + '" title="Posunúť doľava" aria-label="Posunúť doľava">←</button>' : '') +
        (j < v.obrazky.length - 1 ? '<button type="button" data-a="f-vpravo" data-j="' + j + '" title="Posunúť doprava" aria-label="Posunúť doprava">→</button>' : '') +
        '<button type="button" data-a="f-zmazat" data-j="' + j + '" title="Odstrániť" aria-label="Odstrániť">✕</button></div></div>';
    }).join('');
    var nahrava = (v._nahrava || 0) ? '<div class="e-file nahrava">Nahrávam ' + v._nahrava + '…<br>' + (v._percent || 0) + ' %</div>' : '';
    var pozn = '';
    if (st === 'uprava') pozn = '<div class="fb e-pozn"><div class="lbl">Klient chce upraviť</div>' + esc(z.poznamka) + '<small>' + esc(z.meno || 'Klient') + ', ' + esc(datum(z.cas)) + '. Po nahratí opravy a uložení sa variant vráti klientovi na schválenie.</small></div>';
    if (st === 'schvalene') pozn = '<div class="fb ok e-pozn">Schválené' + (z.poznamka ? ': ' + esc(z.poznamka) : '') + '<small>' + esc(z.meno || 'Klient') + ', ' + esc(datum(z.cas)) + '. Ak variant zmeníte, klient ho bude schvaľovať znova.</small></div>';
    var f = function (key, label, attrs) { return '<label class="e-f"><span class="lbl">' + label + '</span><input data-v="' + key + '" value="' + esc(v[key]) + '" ' + (attrs || '') + '></label>'; };
    return '<article class="e-var" data-i="' + i + '" data-stav="' + st + '">' +
      '<div class="e-var-head"><h3>Variant ' + (i + 1) + (v.verzia > 1 ? ' <span class="k-ver">verzia ' + v.verzia + '</span>' : '') + '</h3>' +
      '<span class="pill ' + st + '">' + NAZVY[st] + '</span>' +
      (i > 0 ? '<button class="btn" type="button" data-a="v-hore" aria-label="Posunúť vyššie">↑</button>' : '') +
      (i < n - 1 ? '<button class="btn" type="button" data-a="v-dole" aria-label="Posunúť nižšie">↓</button>' : '') +
      '<button class="btn" type="button" data-a="v-zmazat">Zmazať</button></div>' + pozn +
      '<div class="e-media"><div class="e-files">' + subory + nahrava + '</div>' +
      '<label class="e-drop"><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" data-a="subory">' +
      '<b>Pridať obrázky alebo video</b><span>Kliknite alebo sem pretiahnite súbory. Viac obrázkov = karusel.</span></label></div>' +
      '<div class="e-fields">' + f('nazov', 'Názov variantu', 'maxlength="120" placeholder="Napríklad A: fotka s produktom"') +
      '<div class="e-two">' + f('format', 'Formát', 'list="formaty" maxlength="60"') + f('cta', 'Výzva k akcii (CTA)', 'list="cta" maxlength="60"') + '</div>' +
      f('nadpis', 'Nadpis', 'maxlength="300"') +
      '<label class="e-f"><span class="lbl">Text reklamy</span><textarea data-v="text" maxlength="3000">' + esc(v.text) + '</textarea></label></div></article>';
  }
  function kresli() {
    var vv = s.kampan.varianty;
    $('varianty').innerHTML = vv.length ? vv.map(function (v, i) { return variantHTML(v, i, vv.length); }).join('')
      : '<div class="s-empty"><h2 class="bb">Zatiaľ žiadne varianty</h2>Kliknite na Pridať variant a nahrajte prvý návrh.</div>';
  }
  function kresliVariant(i) {
    var el = document.querySelector('.e-var[data-i="' + i + '"]'); if (!el) return kresli();
    var t = document.createElement('div'); t.innerHTML = variantHTML(s.kampan.varianty[i], i, s.kampan.varianty.length);
    el.replaceWith(t.firstChild);
  }

  function nastavDirty(d) {
    s.dirty = d;
    $('bar').classList.toggle('dirty', d);
    $('bar-stav').textContent = s.nahrava ? 'Nahrávam súbory…' : s.ukladam ? 'Ukladám…' : d ? 'Neuložené zmeny' : 'Všetko uložené. Klient vidí aktuálnu verziu.';
    $('ulozit').disabled = s.ukladam || s.nahrava > 0 || !d;
  }
  function opustit() { return !s.dirty && !s.nahrava || window.confirm('Máte neuložené zmeny. Naozaj odísť?'); }
  window.addEventListener('beforeunload', function (e) { if (s.kampan && (s.dirty || s.nahrava)) { e.preventDefault(); e.returnValue = ''; } });

  document.querySelectorAll('[data-k]').forEach(function (el) {
    el.addEventListener('input', function () { s.kampan[el.dataset.k] = el.value; nastavDirty(true); });
  });
  $('varianty').addEventListener('input', function (e) {
    var t = e.target, art = t.closest('.e-var'); if (!art || !t.dataset.v) return;
    s.kampan.varianty[+art.dataset.i][t.dataset.v] = t.value; nastavDirty(true);
  });
  $('varianty').addEventListener('change', function (e) {
    if (e.target.dataset.a !== 'subory') return;
    var i = +e.target.closest('.e-var').dataset.i; pridajSubory(i, e.target.files); e.target.value = '';
  });
  $('varianty').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    var art = b.closest('.e-var'), i = +art.dataset.i, vv = s.kampan.varianty, v = vv[i], j = +b.dataset.j;
    var a = b.dataset.a;
    if (a === 'f-vlavo') { v.obrazky.splice(j - 1, 0, v.obrazky.splice(j, 1)[0]); kresliVariant(i); }
    else if (a === 'f-vpravo') { v.obrazky.splice(j + 1, 0, v.obrazky.splice(j, 1)[0]); kresliVariant(i); }
    else if (a === 'f-zmazat') { v.obrazky.splice(j, 1); kresliVariant(i); }
    else if (a === 'v-hore') { vv.splice(i - 1, 0, vv.splice(i, 1)[0]); kresli(); }
    else if (a === 'v-dole') { vv.splice(i + 1, 0, vv.splice(i, 1)[0]); kresli(); }
    else if (a === 'v-zmazat') {
      if (!b.classList.contains('potvrd')) { b.classList.add('potvrd'); b.textContent = 'Naozaj zmazať?'; setTimeout(function () { if (b.isConnected) { b.classList.remove('potvrd'); b.textContent = 'Zmazať'; } }, 4000); return; }
      vv.splice(i, 1); kresli();
    }
    nastavDirty(true);
  });
  // ťahanie súborov
  ['dragenter', 'dragover'].forEach(function (ev) {
    $('varianty').addEventListener(ev, function (e) { var d = e.target.closest('.e-drop'); if (!d) return; e.preventDefault(); d.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    $('varianty').addEventListener(ev, function (e) {
      var d = e.target.closest('.e-drop'); if (!d) return; e.preventDefault(); d.classList.remove('over');
      if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) pridajSubory(+d.closest('.e-var').dataset.i, e.dataTransfer.files);
    });
  });

  $('pridat').addEventListener('click', function () {
    var vv = s.kampan.varianty;
    vv.push({ id: 'v' + nahodne(3), nazov: 'Variant ' + String.fromCharCode(65 + (vv.length % 26)), format: '', obrazky: [], nadpis: '', text: '', cta: '' });
    kresli(); nastavDirty(true);
    var posledny = document.querySelector('.e-var:last-of-type'); if (posledny) posledny.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('odkaz').addEventListener('click', function (e) {
    if (!e.target.closest('[data-a="kopirovat"]')) return;
    var url = odkaz(s.kampan.slug);
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Odkaz skopírovaný.'); }, function () { toast(url); });
  });

  $('zmazat').addEventListener('click', function () {
    var b = $('zmazat');
    if (!b.classList.contains('potvrd')) { b.classList.add('potvrd'); b.textContent = 'Naozaj zmazať kampaň, všetky súbory aj rozhodnutia klienta? Kliknite znova.'; setTimeout(function () { b.classList.remove('potvrd'); b.textContent = 'Zmazať celú kampaň'; }, 5000); return; }
    api('DELETE', '/api/kreativy?klient=' + encodeURIComponent(s.kampan.slug)).then(function () {
      nastavDirty(false); s.kampan = null; toast('Kampaň zmazaná.'); location.hash = '';
    }).catch(function (e) { toast(e.message); });
  });

  // ---------- ukladanie ----------
  function ulozit() {
    if (!s.kampan || !s.dirty || s.nahrava || s.ukladam) return;
    var data = JSON.parse(JSON.stringify(s.kampan));
    data.varianty.forEach(function (v) { delete v._nahrava; delete v._percent; });
    s.ukladam = true; nastavDirty(true);
    api('PUT', '/api/kreativy?klient=' + encodeURIComponent(s.kampan.slug), data).then(function (j) {
      s.ukladam = false;
      // zachová rozpísané nahrávanie, prevezme verzie zo servera
      var nahr = {}; s.kampan.varianty.forEach(function (v) { if (v._nahrava) nahr[v.id] = v; });
      s.kampan = j.kampan; s.kampan.varianty.forEach(function (v) { if (nahr[v.id]) { v._nahrava = nahr[v.id]._nahrava; v._percent = nahr[v.id]._percent; } });
      nastavDirty(false); hlavicka();
      return fetch('/api/schvalovanie?klient=' + encodeURIComponent(s.kampan.slug), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (st) {
        if (st) s.stav = st.stav || {};
        kresli();
        toast(j.zmenene && j.zmenene.length ? 'Uložené. Zmenené varianty čakajú na nové schválenie klienta.' : 'Uložené.');
      });
    }).catch(function (e) { s.ukladam = false; nastavDirty(true); toast(e.message); });
  }
  $('ulozit').addEventListener('click', ulozit);
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's' && s.kampan) { e.preventDefault(); ulozit(); } });

  // ---------- súbory ----------
  function zmensi(file) {
    // GIF a video nechá tak, veľké fotky zmenší na max. 2400 px a JPEG
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
    var m = /\.([a-z0-9]+)$/i.exec(f.name || ''); var e = m ? m[1].toLowerCase() : '';
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].indexOf(e) >= 0 ? e : null;
  }
  function nahraj(slug, blob, ext, priebeh) {
    var nazov = nahodne(6) + '.' + ext, spolu = Math.max(1, Math.ceil(blob.size / KUS)), i = 0;
    var dalsi = function () {
      if (i >= spolu) return Promise.resolve('/api/kreativy/subor/' + slug + '/' + nazov);
      var cast = blob.slice(i * KUS, Math.min(blob.size, (i + 1) * KUS));
      return api('PUT', '/api/kreativy/subor?klient=' + slug + '&nazov=' + nazov + '&cast=' + i + '&spolu=' + spolu + '&velkost=' + blob.size, cast, true)
        .then(function () { i++; priebeh(Math.round(i / spolu * 100)); return dalsi(); });
    };
    return dalsi();
  }
  function pridajSubory(i, files) {
    var v = s.kampan.varianty[i], slug = s.kampan.slug;
    var zoznam = Array.prototype.slice.call(files || []);
    if (!zoznam.length) return;
    zoznam = zoznam.filter(function (f) { if (pripona(f)) return true; toast('Súbor ' + f.name + ' nie je obrázok ani video (JPG, PNG, WebP, GIF, MP4, MOV, WebM).'); return false; });
    zoznam = zoznam.filter(function (f) { if (f.size <= 200 * 1024 * 1024) return true; toast('Súbor ' + f.name + ' je väčší ako 200 MB.'); return false; });
    if (v.obrazky.length + zoznam.length > 20) { toast('Jeden variant môže mať najviac 20 súborov.'); zoznam = zoznam.slice(0, Math.max(0, 20 - v.obrazky.length)); }
    if (!zoznam.length) return;
    v._nahrava = (v._nahrava || 0) + zoznam.length; v._percent = 0;
    s.nahrava += zoznam.length; nastavDirty(true); kresliVariant(s.kampan.varianty.indexOf(v));
    var poradie = Promise.resolve();
    zoznam.forEach(function (f) {
      poradie = poradie.then(function () {
        return zmensi(f).then(function (b) {
          var ext = b === f ? pripona(f) : 'jpg';
          return nahraj(slug, b, ext, function (p) { v._percent = p; var el = document.querySelector('.e-var[data-i="' + s.kampan.varianty.indexOf(v) + '"] .nahrava'); if (el) el.innerHTML = 'Nahrávam ' + v._nahrava + '…<br>' + p + ' %'; });
        }).then(function (cesta) {
          // variant mohol byť medzitým nahradený novým objektom zo servera
          var aktual = s.kampan && s.kampan.varianty.filter(function (x) { return x.id === v.id; })[0];
          if (aktual) { aktual.obrazky.push(cesta); v = aktual; }
        }).catch(function (e) { toast('Nahrávanie ' + f.name + ' zlyhalo: ' + e.message); })
          .then(function () {
            s.nahrava--; v._nahrava = Math.max(0, (v._nahrava || 1) - 1); v._percent = 0;
            if (s.kampan) { var idx = s.kampan.varianty.indexOf(v); if (idx >= 0) kresliVariant(idx); nastavDirty(true); }
          });
      });
    });
    poradie.then(function () { if (s.kampan && !s.nahrava) toast('Súbory nahraté. Nezabudnite uložiť.'); });
  }

  // ---------- smerovanie ----------
  function route(j) {
    var slug = location.hash.replace(/^#/, '');
    if (slug) otvor(slug); else zoznam(j);
  }
  var predHash = location.hash;
  window.addEventListener('hashchange', function () {
    if (s.kampan && (s.dirty || s.nahrava) && !window.confirm('Máte neuložené zmeny. Naozaj odísť?')) { history.replaceState(null, '', predHash || location.pathname); return; }
    predHash = location.hash; nastavDirty(false); if (s.heslo) route();
  });

  s.heslo = ss('mnk-tim-heslo') || '';
  if (s.heslo) api('GET', '/api/kreativy').then(function (j) { $('odhlasit').hidden = false; route(j); }).catch(function (e) { if (s.heslo) odhlas(e.message); });
  else odhlas('');
})();
