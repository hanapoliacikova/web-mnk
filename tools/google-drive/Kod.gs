/**
 * MNK: kreatívy zo schvaľovania na webe do Google Drive klienta.
 *
 * Beží pod účtom marketingnakluc@gmail.com každých 5 minút. Zo stránky
 * marketingnakluc.sk/interne/kreativy/ si vypýta kampane, pri ktorých je vyplnený
 * odkaz na priečinok klienta a niečo sa zmenilo, a v priečinku klienta udržiava:
 *
 *   GRAFIKA/
 *     1 ROZPRACOVANÉ/<kampaň>   pre grafičku, skript sem nič nedáva
 *     2 NA SCHVÁLENÍ/<kampaň>   čo klient práve posudzuje
 *     3 NA ÚPRAVU/<kampaň>      čo klient vrátil (poznámka je v popise súboru)
 *     4 SCHVÁLENÉ/<kampaň>      finálne kreatívy
 *     5 ARCHÍV/<kampaň>         staršie verzie a zmazané varianty
 *     Stav kreatív              tabuľka so všetkými variantmi
 *
 * Nastavenie (raz): do HESLO nižšie vložte heslo tímu (to isté ako TIM_HESLO v Netlify),
 * uložte, hore vyberte funkciu "nastav" a kliknite Spustiť. Povoľte prístup.
 */
var HESLO = '';
var WEB = 'https://marketingnakluc.sk';

var STAVY = { caka: '2 NA SCHVÁLENÍ', uprava: '3 NA ÚPRAVU', schvalene: '4 SCHVÁLENÉ' };
var ROZPRACOVANE = '1 ROZPRACOVANÉ';
var ARCHIV = '5 ARCHÍV';
var NAZVY = { caka: 'Čaká', uprava: 'Na úpravu', schvalene: 'Schválené' };
var ZNACKA = 'mnk-kreativa: ';
var ZNACKA_KAMPAN = 'mnk-kampan: ';
var TABULKA = 'Stav kreatív';
var MAX_SUBOR = 45 * 1024 * 1024; // UrlFetchApp zvládne najviac 50 MB
var HLAVICKA = ['ID', 'Kampaň', 'Variant', 'Formát', 'Verzia', 'Stav', 'Poznámka klienta', 'Kto rozhodol', 'Kedy', 'Nadpis', 'Text', 'CTA', 'Súbory na Drive', 'Odkaz pre klienta', 'Aktualizované'];

/** Spustite raz: overí heslo, nastaví spúšťanie každých 5 minút a hneď synchronizuje. */
function nastav() {
  if (!HESLO) throw new Error('Najprv hore do HESLO vložte heslo tímu a uložte (Ctrl+S).');
  api_('get', '/api/kreativy/drive');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'synchronizuj') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('synchronizuj').timeBased().everyMinutes(5).create();
  synchronizuj();
  Logger.log('Hotovo. Synchronizácia beží každých 5 minút.');
}

/** Spúšťa sa automaticky každých 5 minút. */
function synchronizuj() {
  var zamok = LockService.getScriptLock();
  if (!zamok.tryLock(1000)) return;
  try {
    var odpoved = api_('get', '/api/kreativy/drive');
    var web = odpoved.web || WEB;
    (odpoved.kampane || []).forEach(function (k) {
      var vysledok;
      try {
        vysledok = synchronizujKampan_(k, web);
        vysledok.ok = true;
      } catch (e) {
        vysledok = { ok: false, chyba: String((e && e.message) || e), chyby: [] };
      }
      vysledok.slug = k.kampan.slug;
      vysledok.zmena = k.zmena;
      api_('post', '/api/kreativy/drive', vysledok);
      Logger.log(k.kampan.slug + ': ' + (vysledok.ok ? 'OK' : vysledok.chyba));
    });
  } finally {
    zamok.releaseLock();
  }
}

function api_(metoda, cesta, telo) {
  var o = { method: metoda, headers: { 'x-heslo': HESLO }, muteHttpExceptions: true, contentType: 'application/json' };
  if (telo) o.payload = JSON.stringify(telo);
  var r = UrlFetchApp.fetch(WEB + cesta, o);
  if (r.getResponseCode() === 401) throw new Error('Nesprávne heslo tímu v skripte (HESLO).');
  if (r.getResponseCode() >= 300) throw new Error('Web vrátil ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

function idPriecinka_(odkaz) {
  var x = String(odkaz || '').trim();
  var m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(x) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(x) || /^([A-Za-z0-9_-]{10,})$/.exec(x);
  if (!m) throw new Error('Odkaz na Drive nie je odkaz na priečinok.');
  return m[1];
}

function cistyNazov_(x) {
  return String(x || '').replace(/[\/\\:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'Bez názvu';
}

function podpriecinok_(rodic, nazov) {
  var it = rodic.getFoldersByName(nazov);
  return it.hasNext() ? it.next() : rodic.createFolder(nazov);
}

function grafika_(klient) {
  if (/^\s*grafika\s*$/i.test(klient.getName())) return klient;
  var it = klient.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (/^\s*grafika\s*$/i.test(f.getName())) return f;
  }
  return klient.createFolder('GRAFIKA');
}

// Priečinok kampane hľadá podľa značky v popise, takže premenovanie kampane ho len premenuje.
function priecinokKampane_(stavovy, slug, nazov) {
  var it = stavovy.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if ((f.getDescription() || '').indexOf(ZNACKA_KAMPAN + slug) >= 0) {
      if (f.getName() !== nazov) f.setName(nazov);
      return f;
    }
  }
  var novy = stavovy.createFolder(nazov);
  novy.setDescription(ZNACKA_KAMPAN + slug);
  return novy;
}

function jeV_(subor, priecinok) {
  var it = subor.getParents();
  while (it.hasNext()) if (it.next().getId() === priecinok.getId()) return true;
  return false;
}

function datum_(iso) {
  return iso ? Utilities.formatDate(new Date(iso), 'Europe/Bratislava', 'd.M.yyyy HH:mm') : '';
}

function popis_(znacka, v, z, st) {
  var r = ['Variant: ' + v.nazov, 'Verzia: ' + (v.verzia || 1), 'Stav: ' + NAZVY[st]];
  if (st === 'uprava') r.push('Čo upraviť: ' + (z.poznamka || ''));
  if (st === 'schvalene' && z.poznamka) r.push('Poznámka: ' + z.poznamka);
  if (st === 'caka' && z.predtym && z.predtym.status === 'uprava') r.push('Upravené podľa: ' + (z.predtym.poznamka || ''));
  if (z.meno && st !== 'caka') r.push('Rozhodol/a: ' + z.meno + ', ' + datum_(z.cas));
  r.push('', ZNACKA + znacka);
  return r.join('\n');
}

function velkost_(url) {
  var r = UrlFetchApp.fetch(url, { headers: { Range: 'bytes=0-0' }, muteHttpExceptions: true });
  var cr = r.getHeaders()['Content-Range'] || r.getHeaders()['content-range'] || '';
  var m = /\/(\d+)$/.exec(cr);
  return m ? Number(m[1]) : r.getContent().length;
}

function synchronizujKampan_(k, web) {
  var kam = k.kampan, slug = kam.slug, stav = k.stav || {};
  var klient = DriveApp.getFolderById(idPriecinka_(kam.drive));
  var g = grafika_(klient);
  var nazovKampane = cistyNazov_(kam.kampan || kam.klient || slug);

  var p = {};
  [ROZPRACOVANE, STAVY.caka, STAVY.uprava, STAVY.schvalene, ARCHIV].forEach(function (n) {
    p[n] = priecinokKampane_(podpriecinok_(g, n), slug, nazovKampane);
  });

  // súbory, ktoré už skript na Drive dal (spozná ich podľa značky v popise)
  var existujuce = {};
  [STAVY.caka, STAVY.uprava, STAVY.schvalene, ARCHIV].forEach(function (n) {
    var it = p[n].getFiles();
    while (it.hasNext()) {
      var f = it.next();
      var d = f.getDescription() || '';
      var i = d.indexOf(ZNACKA);
      if (i >= 0) existujuce[d.slice(i + ZNACKA.length).split('\n')[0].trim()] = f;
    }
  });

  var chcene = {}, riadky = [], chyby = [];
  var teraz = datum_(new Date().toISOString());
  (kam.varianty || []).forEach(function (v) {
    var z = stav[v.id] || {};
    var st = STAVY[z.status] ? z.status : 'caka';
    var ciel = p[STAVY[st]];
    var odkazy = [];
    (v.obrazky || []).forEach(function (cesta, j) {
      var nazovSuboru = cesta.split('/').pop();
      var ext = nazovSuboru.split('.').pop();
      var znacka = slug + '/' + v.id + '/' + nazovSuboru;
      chcene[znacka] = true;
      var meno = cistyNazov_(nazovKampane + ' - ' + v.nazov + ' - v' + (v.verzia || 1) + (v.obrazky.length > 1 ? ' (' + (j + 1) + ')' : '')) + '.' + ext;
      var popis = popis_(znacka, v, z, st);
      var f = existujuce[znacka];
      try {
        if (!f) {
          var url = web + cesta;
          var bajty = velkost_(url);
          if (bajty > MAX_SUBOR) throw new Error('súbor má ' + Math.round(bajty / 1048576) + ' MB, na Drive sa kopírujú súbory do 45 MB');
          var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
          if (r.getResponseCode() !== 200) throw new Error('súbor sa nepodarilo stiahnuť (' + r.getResponseCode() + ')');
          f = ciel.createFile(r.getBlob().setName(meno));
        } else {
          if (!jeV_(f, ciel)) f.moveTo(ciel);
          if (f.getName() !== meno) f.setName(meno);
        }
        if (f.getDescription() !== popis) f.setDescription(popis);
        odkazy.push(f.getUrl());
      } catch (e) {
        chyby.push(v.nazov + ' (' + (j + 1) + '): ' + e.message);
        odkazy.push(web + cesta);
      }
    });
    var pozn = z.poznamka || '';
    if (st === 'caka' && z.predtym && z.predtym.status === 'uprava') pozn = 'Upravené podľa: ' + (z.predtym.poznamka || '');
    riadky.push([
      slug + '/' + v.id, nazovKampane, v.nazov, v.format || '', v.verzia || 1, NAZVY[st], pozn,
      st === 'caka' ? '' : (z.meno || ''), st === 'caka' ? '' : datum_(z.cas),
      v.nadpis || '', v.text || '', v.cta || '', odkazy.join('\n'), web + '/schvalovanie/' + slug + '/', teraz,
    ]);
  });

  // čo už v kampani nie je (stará verzia, zmazaný variant), ide do archívu
  Object.keys(existujuce).forEach(function (znacka) {
    if (!chcene[znacka] && znacka.indexOf(slug + '/') === 0 && !jeV_(existujuce[znacka], p[ARCHIV])) existujuce[znacka].moveTo(p[ARCHIV]);
  });

  var tabulka = zapisTabulku_(g, slug, riadky);
  return { odkazy: { grafika: g.getUrl(), tabulka: tabulka.getUrl(), kampan: p[STAVY.schvalene].getUrl() }, chyby: chyby };
}

function zapisTabulku_(g, slug, riadky) {
  var it = g.getFilesByName(TABULKA), ss;
  if (it.hasNext()) {
    ss = SpreadsheetApp.openById(it.next().getId());
  } else {
    ss = SpreadsheetApp.create(TABULKA);
    DriveApp.getFileById(ss.getId()).moveTo(g);
  }
  var sh = ss.getSheets()[0];
  var data = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HLAVICKA.length).getValues() : [];
  // riadky iných kampaní ostanú, riadky tejto kampane sa nahradia
  var ine = data.filter(function (r) { return String(r[0]).indexOf(slug + '/') !== 0 && r[0] !== ''; });
  var vsetky = ine.concat(riadky);
  sh.clear();
  sh.getRange(1, 1, 1, HLAVICKA.length).setValues([HLAVICKA]).setFontWeight('bold').setBackground('#E5EFEF');
  sh.setFrozenRows(1);
  if (vsetky.length) {
    sh.getRange(2, 1, vsetky.length, HLAVICKA.length).setValues(vsetky).setWrap(true).setVerticalAlignment('top');
    var farby = { 'Čaká': '#EEEBE7', 'Na úpravu': '#FBE9DC', 'Schválené': '#DDF1EE' };
    sh.getRange(2, 6, vsetky.length, 1).setBackgrounds(vsetky.map(function (r) { return [farby[r[5]] || '#FFFFFF']; }));
  }
  sh.hideColumns(1);
  sh.setColumnWidths(2, 4, 140);
  sh.setColumnWidth(7, 260);
  sh.setColumnWidth(11, 320);
  sh.setColumnWidth(13, 260);
  return ss;
}
