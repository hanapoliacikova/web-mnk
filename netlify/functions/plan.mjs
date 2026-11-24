// MNK Plán: plánovanie postov na sociálne siete (náhrada Kontentina), krok 1.
// Každý člen tímu má vlastné prihlásenie. Účty zakladá správca heslom tímu (TIM_HESLO).
// Uložené v Netlify Blobs, store "plan":
//   pouzivatelia/<login>                {login, meno, hash, sol, aktivny, vytvorene}
//   relacie/<sha256 tokenu>             {login, plati_do}
//   klienti/<id>                        {id, nazov, farba, kanaly[], kampane[], vytvorene, upravene}
//   posty/<klient>/<YYYY-MM>/<id>       post
//   kde/<klient>/<id>                   "YYYY-MM", v ktorom mesiaci post leží
//
// Prihlásenie:
//   POST   /api/plan/prihlasit            {login, heslo} -> {token, ja}
//   POST   /api/plan/odhlasit             (Authorization: Bearer <token>)
//   GET    /api/plan/ja
//   POST   /api/plan/heslo                {stare, nove} zmena vlastného hesla
// Správa tímu (hlavička x-heslo = TIM_HESLO):
//   GET    /api/plan/tim
//   POST   /api/plan/tim                  {login, meno, heslo}
//   PUT    /api/plan/tim?login=           {meno, heslo?, aktivny}
// Pre prihlásených:
//   GET    /api/plan/klienti
//   POST   /api/plan/klienti              {nazov}
//   PUT    /api/plan/klienti?id=          celý klient (názov, farba, kanály, kampane)
//   DELETE /api/plan/klienti?id=          klient aj jeho posty
//   GET    /api/plan/posty?mesiac=YYYY-MM[&klient=id]
//   POST   /api/plan/posty                nový post
//   PUT    /api/plan/posty?klient=&id=    úprava postu (aj presun na iný deň)
//   DELETE /api/plan/posty?klient=&id=
//   PUT    /api/plan/subor?klient=&nazov=&cast=&spolu=&velkost=   nahrá kúsok vizuálu (po 4 MB)
// Verejné (názov súboru je náhodný):
//   GET    /api/plan/subor/<klient>/<nazov>   obrázok alebo video, podporuje Range
//   subory/<klient>/<nazov>             popis súboru {typ, velkost, casti, kus, cas, hotovo}
//   subory/<klient>/<nazov>/c<i>        obsah súboru po kúskoch
import { getStore } from '@netlify/blobs';
import { randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { hesloOk, hesloNastavene } from '../tim-heslo.mjs';

export const config = {
  path: ['/api/plan', '/api/plan/:cast', '/api/plan/subor/:klient/:nazov'],
};

const LOGIN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const ID = /^[a-z0-9-]{3,60}$/;
const DATUM = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MESIAC = /^\d{4}-(0[1-9]|1[0-2])$/;
const CAS = /^([01]\d|2[0-3]):[0-5]\d$/;
const FARBA = /^#[0-9a-fA-F]{6}$/;
export const SIETE = ['ig', 'fb', 'tiktok', 'linkedin'];
export const TYPY = ['post', 'karusel', 'reels', 'story', 'video', 'text'];
export const STAVY = ['koncept', 'interna', 'klient', 'uprava', 'schvalene', 'zverejnene'];
const NAZOV = /^[a-z0-9]{8,40}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$/;
const TYPY_SUBOROV = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
export const KUS = 4 * 1024 * 1024; // musí sedieť s KUS v interne/plan/plan.js
const MAX_SUBOR = 200 * 1024 * 1024;
const MAX_MEDII = 20;
const RELACIA_DNI = 30;
const MIN_HESLO = 8;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const nove = (pred) => pred + '-' + randomBytes(5).toString('hex');
const sha = (x) => createHash('sha256').update(String(x)).digest('hex');

export function hashHesla(heslo, sol = randomBytes(16).toString('hex')) {
  return { sol, hash: scryptSync(String(heslo), sol, 32).toString('hex') };
}
function hesloSedi(heslo, u) {
  if (!u || !u.hash || !u.sol) return false;
  const a = Buffer.from(hashHesla(heslo, u.sol).hash, 'hex');
  const b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const verejny = (u) => ({ login: u.login, meno: u.meno, aktivny: u.aktivny !== false });

async function telo(req, max = 200000) {
  const t = await req.text();
  if (t.length > max) throw Object.assign(new Error('Príliš veľa dát.'), { status: 413 });
  try { return JSON.parse(t || '{}'); } catch { throw Object.assign(new Error('Neplatné dáta.'), { status: 400 }); }
}

async function prihlaseny(req, store) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const r = await store.get(`relacie/${sha(m[1])}`, { type: 'json' });
  if (!r || Date.parse(r.plati_do) < Date.now()) return null;
  const u = await store.get(`pouzivatelia/${r.login}`, { type: 'json' });
  if (!u || u.aktivny === false) return null;
  return { ...u, kluc: `relacie/${sha(m[1])}` };
}

// ---------- klienti ----------
function vycistiKlienta(b, pred) {
  const kanaly = (Array.isArray(b.kanaly) ? b.kanaly : []).slice(0, 20)
    .filter((k) => k && SIETE.includes(k.siet))
    .map((k) => ({ id: ID.test(k.id || '') ? k.id : nove('k'), siet: k.siet, nazov: txt(k.nazov, 80) }));
  const kampane = (Array.isArray(b.kampane) ? b.kampane : []).slice(0, 100)
    .filter((k) => k && txt(k.nazov, 120))
    .map((k) => ({
      id: ID.test(k.id || '') ? k.id : nove('c'),
      nazov: txt(k.nazov, 120),
      farba: FARBA.test(k.farba || '') ? k.farba : '#2B988F',
      archiv: Boolean(k.archiv),
    }));
  return {
    id: pred.id,
    nazov: txt(b.nazov, 120) || pred.nazov,
    farba: FARBA.test(b.farba || '') ? b.farba : (pred.farba || '#226D6E'),
    kanaly,
    kampane,
    vytvorene: pred.vytvorene,
    upravene: new Date().toISOString(),
  };
}

// ---------- posty ----------
function vycistiPost(b, klient, pred, kto) {
  const kanaly = (Array.isArray(b.kanaly) ? b.kanaly : []).filter((k) => SIETE.includes(k));
  const kampan = klient.kampane.some((k) => k.id === b.kampan) ? b.kampan : '';
  const teraz = new Date().toISOString();
  return {
    id: pred ? pred.id : nove('p'),
    klient: klient.id,
    kampan,
    datum: DATUM.test(b.datum || '') ? b.datum : (pred && pred.datum) || '',
    cas: CAS.test(b.cas || '') ? b.cas : '',
    kanaly: [...new Set(kanaly)],
    typ: TYPY.includes(b.typ) ? b.typ : 'post',
    nazov: txt(b.nazov, 120),
    media: (Array.isArray(b.media) ? b.media : []).map(String)
      .filter((f) => f.startsWith(`/api/plan/subor/${klient.id}/`) && NAZOV.test(f.split('/').pop()))
      .slice(0, MAX_MEDII),
    text: txt(b.text, 5000),
    poznamka: txt(b.poznamka, 1000),
    stav: pred ? pred.stav : 'koncept',
    autor: pred ? pred.autor : kto.meno,
    vytvorene: pred ? pred.vytvorene : teraz,
    upravene: teraz,
    upravil: kto.meno,
  };
}

async function zmazSubor(store, klientId, cesta) {
  const nazov = String(cesta).split('/').pop();
  if (!NAZOV.test(nazov)) return;
  const { blobs } = await store.list({ prefix: `subory/${klientId}/${nazov}` });
  await Promise.all(blobs.map(({ key }) => store.delete(key)));
}

async function servirujSubor(req, store, klientId, nazov) {
  if (!ID.test(klientId || '') || !NAZOV.test(nazov || '')) return new Response('Nenájdené', { status: 404 });
  const meta = await store.get(`subory/${klientId}/${nazov}`, { type: 'json' });
  if (!meta || !meta.hotovo) return new Response('Nenájdené', { status: 404 });
  const hlavicky = {
    'Content-Type': meta.typ, 'Accept-Ranges': 'bytes', 'X-Robots-Tag': 'noindex',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  const kus = meta.kus || KUS;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    const od = range[1] ? Number(range[1]) : Math.max(0, meta.velkost - Number(range[2]));
    if (od >= meta.velkost) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${meta.velkost}` } });
    const i = Math.floor(od / kus);
    let po = range[1] && range[2] ? Number(range[2]) : meta.velkost - 1;
    po = Math.min(po, (i + 1) * kus - 1, meta.velkost - 1);
    const buf = await store.get(`subory/${klientId}/${nazov}/c${i}`, { type: 'arrayBuffer' });
    if (!buf) return new Response('Nenájdené', { status: 404 });
    const cast = buf.slice(od - i * kus, po - i * kus + 1);
    return new Response(cast, { status: 206, headers: { ...hlavicky, 'Content-Range': `bytes ${od}-${po}/${meta.velkost}`, 'Content-Length': String(cast.byteLength) } });
  }
  let i = 0;
  const stream = new ReadableStream({
    async pull(ctrl) {
      if (i >= meta.casti) { ctrl.close(); return; }
      const buf = await store.get(`subory/${klientId}/${nazov}/c${i++}`, { type: 'arrayBuffer' });
      ctrl.enqueue(new Uint8Array(buf));
    },
  });
  return new Response(stream, { status: 200, headers: { ...hlavicky, 'Content-Length': String(meta.velkost) } });
}

async function postyMesiaca(store, klientId, mesiac) {
  const { blobs } = await store.list({ prefix: `posty/${klientId}/${mesiac}/` });
  return (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean);
}

export async function handle(req, store) {
  const url = new URL(req.url);
  const cast = url.pathname.replace(/\/+$/, '').split('/')[3] || '';
  const q = (k) => url.searchParams.get(k) || '';
  const m = req.method;

  try {
    // ---------- vizuály (verejné, názov je náhodný) ----------
    if (cast === 'subor' && m === 'GET') {
      const [, , , , klientId, nazov] = url.pathname.split('/');
      return servirujSubor(req, store, klientId, nazov);
    }

    // ---------- prihlásenie ----------
    if (cast === 'prihlasit' && m === 'POST') {
      const b = await telo(req, 2000);
      const login = txt(b.login, 40).toLowerCase();
      const u = LOGIN.test(login) && (await store.get(`pouzivatelia/${login}`, { type: 'json' }));
      if (!u || u.aktivny === false || !hesloSedi(b.heslo || '', u)) {
        await new Promise((r) => setTimeout(r, 400));
        return json({ chyba: 'Nesprávne meno alebo heslo.' }, 401);
      }
      const token = randomBytes(32).toString('base64url');
      await store.setJSON(`relacie/${sha(token)}`, { login, plati_do: new Date(Date.now() + RELACIA_DNI * 864e5).toISOString() });
      return json({ token, ja: verejny(u) });
    }

    // ---------- správa tímu (heslo tímu) ----------
    if (cast === 'tim') {
      if (!hesloNastavene()) return json({ chyba: 'Heslo tímu nie je nastavené v Netlify (premenná TIM_HESLO).' }, 503);
      if (!hesloOk(req.headers.get('x-heslo'))) return json({ chyba: 'Nesprávne heslo tímu.' }, 403);
      if (m === 'GET') {
        const { blobs } = await store.list({ prefix: 'pouzivatelia/' });
        const ludia = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean).map(verejny);
        ludia.sort((a, b) => a.meno.localeCompare(b.meno, 'sk'));
        return json({ ludia });
      }
      const b = await telo(req, 2000);
      if (m === 'POST') {
        const login = txt(b.login, 40).toLowerCase();
        const meno = txt(b.meno, 80);
        if (!LOGIN.test(login)) return json({ chyba: 'Prihlasovacie meno: malé písmená bez diakritiky, číslice, bodka alebo pomlčka (napr. martina).' }, 400);
        if (!meno) return json({ chyba: 'Napíšte celé meno.' }, 400);
        if (String(b.heslo || '').length < MIN_HESLO) return json({ chyba: `Heslo musí mať aspoň ${MIN_HESLO} znakov.` }, 400);
        if (await store.get(`pouzivatelia/${login}`, { type: 'json' })) return json({ chyba: 'Toto prihlasovacie meno už existuje.' }, 409);
        const u = { login, meno, ...hashHesla(b.heslo), aktivny: true, vytvorene: new Date().toISOString() };
        await store.setJSON(`pouzivatelia/${login}`, u);
        return json({ ok: true, clovek: verejny(u) }, 201);
      }
      if (m === 'PUT') {
        const login = q('login');
        const u = LOGIN.test(login) && (await store.get(`pouzivatelia/${login}`, { type: 'json' }));
        if (!u) return json({ chyba: 'Neznámy človek.' }, 404);
        if (b.meno !== undefined && txt(b.meno, 80)) u.meno = txt(b.meno, 80);
        if (b.aktivny !== undefined) u.aktivny = Boolean(b.aktivny);
        if (b.heslo) {
          if (String(b.heslo).length < MIN_HESLO) return json({ chyba: `Heslo musí mať aspoň ${MIN_HESLO} znakov.` }, 400);
          Object.assign(u, hashHesla(b.heslo));
        }
        await store.setJSON(`pouzivatelia/${login}`, u);
        return json({ ok: true, clovek: verejny(u) });
      }
      return json({ chyba: 'Nepodporovaná metóda.' }, 405);
    }

    // ---------- všetko ostatné len pre prihlásených ----------
    const ja = await prihlaseny(req, store);
    if (!ja) return json({ chyba: 'Prihláste sa.' }, 401);

    if (cast === 'ja' && m === 'GET') return json({ ja: verejny(ja) });
    if (cast === 'odhlasit' && m === 'POST') { await store.delete(ja.kluc); return json({ ok: true }); }
    if (cast === 'heslo' && m === 'POST') {
      const b = await telo(req, 2000);
      if (!hesloSedi(b.stare || '', ja)) return json({ chyba: 'Súčasné heslo nesedí.' }, 400);
      if (String(b.nove || '').length < MIN_HESLO) return json({ chyba: `Nové heslo musí mať aspoň ${MIN_HESLO} znakov.` }, 400);
      const { kluc, ...u } = ja;
      await store.setJSON(`pouzivatelia/${u.login}`, { ...u, ...hashHesla(b.nove) });
      return json({ ok: true });
    }

    if (cast === 'subor' && m === 'PUT') {
      const kid = q('klient'), nazov = q('nazov');
      const cislo = Number(q('cast')), spolu = Number(q('spolu')), velkost = Number(q('velkost'));
      if (!ID.test(kid) || !NAZOV.test(nazov)) return json({ chyba: 'Neplatný názov súboru.' }, 400);
      if (!(await store.get(`klienti/${kid}`, { type: 'json' }))) return json({ chyba: 'Neznámy klient.' }, 404);
      if (!Number.isInteger(cislo) || !Number.isInteger(spolu) || cislo < 0 || cislo >= spolu || !(velkost > 0) || velkost > MAX_SUBOR || spolu !== Math.ceil(velkost / KUS)) {
        return json({ chyba: velkost > MAX_SUBOR ? 'Súbor je väčší ako 200 MB.' : 'Neplatné údaje o súbore.' }, 400);
      }
      const buf = await req.arrayBuffer();
      const ocakavane = cislo < spolu - 1 ? KUS : velkost - KUS * (spolu - 1);
      if (buf.byteLength !== ocakavane) return json({ chyba: 'Kúsok súboru nemá správnu veľkosť.' }, 400);
      await store.set(`subory/${kid}/${nazov}/c${cislo}`, buf);
      const meta = { typ: TYPY_SUBOROV[nazov.split('.').pop()], velkost, casti: spolu, kus: KUS, cas: new Date().toISOString(), hotovo: false };
      if (cislo === spolu - 1) {
        const { blobs } = await store.list({ prefix: `subory/${kid}/${nazov}/c` });
        meta.hotovo = blobs.length === spolu;
      }
      await store.setJSON(`subory/${kid}/${nazov}`, meta);
      return json({ ok: true, hotovo: meta.hotovo, cesta: `/api/plan/subor/${kid}/${nazov}` });
    }

    if (cast === 'klienti') {
      if (m === 'GET') {
        const { blobs } = await store.list({ prefix: 'klienti/' });
        const klienti = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean);
        klienti.sort((a, b) => a.nazov.localeCompare(b.nazov, 'sk'));
        return json({ klienti });
      }
      if (m === 'POST') {
        const b = await telo(req);
        const nazov = txt(b.nazov, 120);
        if (!nazov) return json({ chyba: 'Napíšte názov klienta.' }, 400);
        const teraz = new Date().toISOString();
        const k = vycistiKlienta({ ...b, nazov }, { id: nove('kl'), vytvorene: teraz });
        await store.setJSON(`klienti/${k.id}`, k);
        return json({ ok: true, klient: k }, 201);
      }
      const id = q('id');
      const pred = ID.test(id) && (await store.get(`klienti/${id}`, { type: 'json' }));
      if (!pred) return json({ chyba: 'Neznámy klient.' }, 404);
      if (m === 'PUT') {
        const b = await telo(req);
        if (b.upravene && pred.upravene && b.upravene !== pred.upravene) {
          return json({ chyba: 'Klienta medzitým upravil niekto iný. Obnovte stránku.', klient: pred }, 409);
        }
        const k = vycistiKlienta(b, pred);
        await store.setJSON(`klienti/${id}`, k);
        return json({ ok: true, klient: k });
      }
      if (m === 'DELETE') {
        for (const prefix of [`posty/${id}/`, `kde/${id}/`, `subory/${id}/`]) {
          const { blobs } = await store.list({ prefix });
          await Promise.all(blobs.map(({ key }) => store.delete(key)));
        }
        await store.delete(`klienti/${id}`);
        return json({ ok: true });
      }
      return json({ chyba: 'Nepodporovaná metóda.' }, 405);
    }

    if (cast === 'posty') {
      if (m === 'GET') {
        const mesiac = q('mesiac');
        if (!MESIAC.test(mesiac)) return json({ chyba: 'Chýba mesiac.' }, 400);
        let ids;
        if (q('klient')) ids = [q('klient')].filter((x) => ID.test(x));
        else ids = (await store.list({ prefix: 'klienti/' })).blobs.map(({ key }) => key.slice(8));
        const posty = (await Promise.all(ids.map((id) => postyMesiaca(store, id, mesiac)))).flat();
        posty.sort((a, b) => (a.datum + (a.cas || '99')).localeCompare(b.datum + (b.cas || '99')));
        return json({ posty });
      }
      if (m === 'POST') {
        const b = await telo(req);
        const klient = ID.test(b.klient || '') && (await store.get(`klienti/${b.klient}`, { type: 'json' }));
        if (!klient) return json({ chyba: 'Vyberte klienta.' }, 400);
        if (!DATUM.test(b.datum || '')) return json({ chyba: 'Vyberte dátum.' }, 400);
        const p = vycistiPost(b, klient, null, ja);
        const mes = p.datum.slice(0, 7);
        await store.setJSON(`posty/${klient.id}/${mes}/${p.id}`, p);
        await store.set(`kde/${klient.id}/${p.id}`, mes);
        return json({ ok: true, post: p }, 201);
      }
      const kid = q('klient'), id = q('id');
      if (!ID.test(kid) || !ID.test(id)) return json({ chyba: 'Neznámy post.' }, 404);
      const mes = await store.get(`kde/${kid}/${id}`);
      const pred = mes && (await store.get(`posty/${kid}/${mes}/${id}`, { type: 'json' }));
      if (!pred) return json({ chyba: 'Post neexistuje, možno ho medzitým niekto zmazal.' }, 404);
      if (m === 'PUT') {
        const b = await telo(req);
        if (b.upravene && b.upravene !== pred.upravene) {
          return json({ chyba: `Post medzitým upravil(a) ${pred.upravil}. Obnovte ho a zmeny urobte znova.`, post: pred }, 409);
        }
        const klient = await store.get(`klienti/${kid}`, { type: 'json' });
        if (!klient) return json({ chyba: 'Neznámy klient.' }, 404);
        const p = vycistiPost(b, klient, pred, ja);
        const novyMes = p.datum.slice(0, 7);
        await store.setJSON(`posty/${kid}/${novyMes}/${id}`, p);
        if (novyMes !== mes) {
          await store.set(`kde/${kid}/${id}`, novyMes);
          await store.delete(`posty/${kid}/${mes}/${id}`);
        }
        const ostava = new Set(p.media);
        await Promise.all((pred.media || []).filter((f) => !ostava.has(f)).map((f) => zmazSubor(store, kid, f)));
        return json({ ok: true, post: p });
      }
      if (m === 'DELETE') {
        await store.delete(`posty/${kid}/${mes}/${id}`);
        await store.delete(`kde/${kid}/${id}`);
        await Promise.all((pred.media || []).map((f) => zmazSubor(store, kid, f)));
        return json({ ok: true });
      }
      return json({ chyba: 'Nepodporovaná metóda.' }, 405);
    }

    return json({ chyba: 'Nenájdené.' }, 404);
  } catch (e) {
    if (e.status) return json({ chyba: e.message }, e.status);
    throw e;
  }
}

export default async (req) => handle(req, getStore({ name: 'plan', consistency: 'strong' }));
