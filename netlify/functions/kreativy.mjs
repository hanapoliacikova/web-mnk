// Kampane na schvaľovanie, ktoré tím nahráva cez /interne/kreativy/ (bez GitHubu).
// Uložené v Netlify Blobs, store "kreativy":
//   kampane/<slug>                    JSON kampane (rovnaký tvar ako kampan.json)
//   subory/<slug>/<nazov>             popis súboru {typ, velkost, casti, cas}
//   subory/<slug>/<nazov>/c<i>        obsah súboru po kúskoch (veľké videá)
//
// Verejné (slug je tajný odkaz klienta):
//   GET    /api/kreativy/kampan?klient=<slug>
//   GET    /api/kreativy/subor/<slug>/<nazov>        obrázok alebo video, podporuje Range
// Pre tím (hlavička x-heslo = TIM_HESLO):
//   GET    /api/kreativy                             zoznam kampaní
//   POST   /api/kreativy                             {klient, kampan} založí kampaň, vráti slug
//   PUT    /api/kreativy?klient=<slug>               uloží celú kampaň
//   DELETE /api/kreativy?klient=<slug>               zmaže kampaň aj súbory
//   PUT    /api/kreativy/subor?klient=&nazov=&cast=&spolu=&typ=&velkost=   nahrá kúsok súboru
//   GET    /api/kreativy?klient=<slug>               kampaň aj s odkazom na Drive a stavom synchronizácie
// Pre Google skript, ktorý kopíruje kreatívy na Drive (tools/google-drive/Kod.gs), tiež s x-heslo:
//   GET    /api/kreativy/drive                       kampane s odkazom na Drive, ktoré sa zmenili od poslednej synchronizácie
//   POST   /api/kreativy/drive                       {slug, zmena, ok, chyba, chyby, odkazy} výsledok synchronizácie
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';
import { hesloOk, hesloNastavene } from '../tim-heslo.mjs';
import klientiZRepa from '../schvalovanie-klienti.mjs';

export const config = {
  path: ['/api/kreativy', '/api/kreativy/kampan', '/api/kreativy/drive', '/api/kreativy/subor', '/api/kreativy/subor/:slug/:nazov'],
};

const SLUG = /^[a-z0-9-]{3,60}$/;
const ID = /^[a-z0-9-]{1,60}$/;
const NAZOV = /^[a-z0-9-]{4,40}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$/;
const TYPY = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
export const KUS = 4 * 1024 * 1024; // jeden kúsok súboru, pod limitom 6 MB na požiadavku
const MAX_SUBOR = 200 * 1024 * 1024;
const MAX_VARIANTOV = 60;
const MAX_SUBOROV = 20;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });

const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const DRIVE = /^https:\/\/drive\.google\.com\/[^\s"'<>]+$|^[A-Za-z0-9_-]{20,80}$/;
const OPAKOVAT_PO_CHYBE = 15 * 60 * 1000;

async function stavKampane(stavStore, slug) {
  const stav = {};
  if (!stavStore) return stav;
  const { blobs } = await stavStore.list({ prefix: slug + '/' });
  await Promise.all(blobs.map(async ({ key }) => {
    const z = await stavStore.get(key, { type: 'json' });
    if (z) stav[key.slice(slug.length + 1)] = { status: z.status, poznamka: z.poznamka, meno: z.meno, cas: z.cas, info: z.info, predtym: z.predtym };
  }));
  return stav;
}
const poslednaZmena = (kampan, stav) =>
  [kampan.upravene, ...Object.values(stav).map((z) => z.cas)].filter(Boolean).sort().pop() || '';
const verejna = (k) => { const { drive, ...zvysok } = k; return zvysok; };

export function slugZ(meno) {
  const zaklad = String(meno || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'klient';
  return zaklad + '-' + randomBytes(3).toString('hex').slice(0, 4);
}

// Bezpečne prečíta kampaň poslanú z editora. Ponechá len známe polia.
function vycisti(slug, b, predtym) {
  const varianty = (Array.isArray(b.varianty) ? b.varianty : []).slice(0, MAX_VARIANTOV).map((v) => {
    const id = ID.test(v && v.id) ? v.id : 'v' + randomBytes(3).toString('hex');
    const obrazky = (Array.isArray(v.obrazky) ? v.obrazky : [])
      .map((f) => String(f))
      .filter((f) => f.startsWith(`/api/kreativy/subor/${slug}/`) && NAZOV.test(f.split('/').pop()))
      .slice(0, MAX_SUBOROV);
    return {
      id,
      nazov: txt(v.nazov, 120) || 'Variant',
      format: txt(v.format, 60),
      obrazky,
      nadpis: txt(v.nadpis, 300),
      text: txt(v.text, 3000),
      cta: txt(v.cta, 60),
    };
  });
  // Verzia sa zvýši, keď sa zmení obsah variantu (obrázky alebo texty).
  const stare = Object.fromEntries(((predtym && predtym.varianty) || []).map((v) => [v.id, v]));
  const zmenene = [];
  varianty.forEach((v) => {
    const s = stare[v.id];
    if (!s) { v.verzia = 1; return; }
    const obsah = (x) => JSON.stringify([x.obrazky, x.nadpis, x.text, x.cta, x.format]);
    v.verzia = s.verzia || 1;
    if (obsah(s) !== obsah(v)) { v.verzia += 1; zmenene.push(v.id); }
  });
  const termin = /^\d{4}-\d{2}-\d{2}$/.test(b.termin || '') ? b.termin : '';
  return {
    kampan: {
      slug,
      klient: txt(b.klient, 120) || (predtym && predtym.klient) || 'Klient',
      kampan: txt(b.kampan, 160),
      kanal: txt(b.kanal, 120),
      termin,
      uvod: txt(b.uvod, 1000),
      drive: DRIVE.test(txt(b.drive, 300)) ? txt(b.drive, 300) : '',
      varianty,
      vytvorene: (predtym && predtym.vytvorene) || new Date().toISOString(),
      upravene: new Date().toISOString(),
    },
    zmenene,
  };
}

// Pri novej verzii variantu vráti jeho stav na "čaká", aby ho klient posúdil znova.
async function novaVerzia(stavStore, slug, ids, kampan) {
  await Promise.all(ids.map(async (id) => {
    const key = `${slug}/${id}`;
    const z = await stavStore.get(key, { type: 'json' });
    if (!z || z.status === 'caka') return;
    const v = kampan.varianty.find((x) => x.id === id);
    const zaznam = { status: 'caka', poznamka: '', meno: 'MNK', cas: new Date().toISOString(), info: `Nová verzia ${v ? v.verzia : ''}`.trim() };
    const historia = (Array.isArray(z.historia) ? z.historia : []).concat([zaznam]).slice(-30);
    await stavStore.setJSON(key, { ...zaznam, predtym: { status: z.status, poznamka: z.poznamka, meno: z.meno, cas: z.cas }, historia });
  }));
}

async function zmazSubor(store, slug, nazov) {
  const { blobs } = await store.list({ prefix: `subory/${slug}/${nazov}` });
  await Promise.all(blobs.map(({ key }) => store.delete(key)));
}

// Zmaže súbory, ktoré už žiadny variant nepoužíva (staršie ako deň, aby sa nezmazalo práve nahrávané).
async function upratSubory(store, slug, kampan) {
  const pouzite = new Set(kampan.varianty.flatMap((v) => v.obrazky.map((f) => f.split('/').pop())));
  const { blobs } = await store.list({ prefix: `subory/${slug}/` });
  const den = Date.now() - 24 * 3600 * 1000;
  for (const { key } of blobs) {
    const nazov = key.slice(`subory/${slug}/`.length);
    if (nazov.includes('/') || pouzite.has(nazov)) continue;
    const meta = await store.get(key, { type: 'json' });
    if (!meta || Date.parse(meta.cas) < den) await zmazSubor(store, slug, nazov);
  }
}

async function servirujSubor(req, store, slug, nazov) {
  if (!SLUG.test(slug || '') || !NAZOV.test(nazov || '')) return new Response('Nenájdené', { status: 404 });
  const meta = await store.get(`subory/${slug}/${nazov}`, { type: 'json' });
  if (!meta || !meta.hotovo) return new Response('Nenájdené', { status: 404 });
  const hlavicky = {
    'Content-Type': meta.typ, 'Accept-Ranges': 'bytes', 'X-Robots-Tag': 'noindex',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  const kus = meta.kus || KUS;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let od = range[1] ? Number(range[1]) : Math.max(0, meta.velkost - Number(range[2]));
    if (od >= meta.velkost) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${meta.velkost}` } });
    const i = Math.floor(od / kus);
    let po = range[1] && range[2] ? Number(range[2]) : meta.velkost - 1;
    po = Math.min(po, (i + 1) * kus - 1, meta.velkost - 1);
    const buf = await store.get(`subory/${slug}/${nazov}/c${i}`, { type: 'arrayBuffer' });
    if (!buf) return new Response('Nenájdené', { status: 404 });
    const cast = buf.slice(od - i * kus, po - i * kus + 1);
    return new Response(cast, { status: 206, headers: { ...hlavicky, 'Content-Range': `bytes ${od}-${po}/${meta.velkost}`, 'Content-Length': String(cast.byteLength) } });
  }
  if (meta.casti === 1) {
    const buf = await store.get(`subory/${slug}/${nazov}/c0`, { type: 'arrayBuffer' });
    return new Response(buf, { status: 200, headers: { ...hlavicky, 'Content-Length': String(meta.velkost) } });
  }
  let i = 0;
  const stream = new ReadableStream({
    async pull(ctrl) {
      if (i >= meta.casti) { ctrl.close(); return; }
      const buf = await store.get(`subory/${slug}/${nazov}/c${i++}`, { type: 'arrayBuffer' });
      ctrl.enqueue(new Uint8Array(buf));
    },
  });
  return new Response(stream, { status: 200, headers: { ...hlavicky, 'Content-Length': String(meta.velkost) } });
}

export async function handle(req, store, stavStore, ctx = {}) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const q = (k) => url.searchParams.get(k);

  // verejné
  if (p.startsWith('/api/kreativy/subor/') && req.method === 'GET') {
    const [slug, nazov] = (ctx.params && ctx.params.slug) ? [ctx.params.slug, ctx.params.nazov] : p.split('/').slice(4);
    return servirujSubor(req, store, slug, nazov);
  }
  if (p === '/api/kreativy/kampan') {
    const slug = q('klient');
    if (req.method !== 'GET' || !SLUG.test(slug || '')) return json({ chyba: 'Neznámy klient.' }, 404);
    const k = await store.get(`kampane/${slug}`, { type: 'json' });
    return k ? json(verejna(k)) : json({ chyba: 'Neznámy klient.' }, 404);
  }

  // tím
  if (!hesloNastavene()) return json({ chyba: 'Heslo tímu nie je nastavené v Netlify (premenná TIM_HESLO).' }, 503);
  if (!hesloOk(req.headers.get('x-heslo'))) return json({ chyba: 'Nesprávne heslo.' }, 401);

  if (p === '/api/kreativy/subor' && req.method === 'PUT') {
    const slug = q('klient'), nazov = q('nazov');
    const cast = Number(q('cast')), spolu = Number(q('spolu')), velkost = Number(q('velkost'));
    if (!SLUG.test(slug || '') || !NAZOV.test(nazov || '')) return json({ chyba: 'Neplatný názov súboru.' }, 400);
    if (!(await store.get(`kampane/${slug}`, { type: 'json' }))) return json({ chyba: 'Kampaň neexistuje.' }, 404);
    if (!Number.isInteger(cast) || !Number.isInteger(spolu) || cast < 0 || cast >= spolu || !(velkost > 0) || velkost > MAX_SUBOR || spolu !== Math.ceil(velkost / KUS)) {
      return json({ chyba: velkost > MAX_SUBOR ? 'Súbor je väčší ako 200 MB.' : 'Neplatné údaje o súbore.' }, 400);
    }
    const buf = await req.arrayBuffer();
    const ocakavane = cast < spolu - 1 ? KUS : velkost - KUS * (spolu - 1);
    if (buf.byteLength !== ocakavane) return json({ chyba: 'Kúsok súboru nemá správnu veľkosť.' }, 400);
    await store.set(`subory/${slug}/${nazov}/c${cast}`, buf);
    const typ = TYPY[nazov.split('.').pop()];
    const meta = { typ, velkost, casti: spolu, kus: KUS, cas: new Date().toISOString(), hotovo: false };
    if (cast === spolu - 1) {
      const { blobs } = await store.list({ prefix: `subory/${slug}/${nazov}/c` });
      meta.hotovo = blobs.length === spolu;
    }
    await store.setJSON(`subory/${slug}/${nazov}`, meta);
    return json({ ok: true, hotovo: meta.hotovo, cesta: `/api/kreativy/subor/${slug}/${nazov}` });
  }

  if (p === '/api/kreativy/drive') {
    if (req.method === 'GET') {
      const { blobs } = await store.list({ prefix: 'kampane/' });
      const kampane = [];
      for (const { key } of blobs) {
        const k = await store.get(key, { type: 'json' });
        if (!k || !k.drive) continue;
        const stav = await stavKampane(stavStore, k.slug);
        const zmena = poslednaZmena(k, stav);
        const info = await store.get(`drive/${k.slug}`, { type: 'json' });
        const hotovo = info && info.zmena === zmena && (info.ok || Date.now() - Date.parse(info.cas) < OPAKOVAT_PO_CHYBE);
        if (!hotovo) kampane.push({ kampan: k, stav, zmena });
      }
      return json({ kampane, web: url.origin });
    }
    if (req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ chyba: 'Neplatné dáta.' }, 400); }
      if (!SLUG.test((b && b.slug) || '') || !(await store.get(`kampane/${b.slug}`, { type: 'json' }))) return json({ chyba: 'Neznámy klient.' }, 404);
      const odkazy = {};
      ['grafika', 'tabulka', 'kampan'].forEach((x) => { if (/^https:\/\/(drive|docs)\.google\.com\//.test((b.odkazy || {})[x] || '')) odkazy[x] = b.odkazy[x]; });
      await store.setJSON(`drive/${b.slug}`, {
        zmena: txt(b.zmena, 40), ok: Boolean(b.ok), chyba: txt(b.chyba, 500),
        chyby: (Array.isArray(b.chyby) ? b.chyby : []).slice(0, 20).map((x) => txt(x, 300)),
        odkazy, cas: new Date().toISOString(),
      });
      return json({ ok: true });
    }
    return json({ chyba: 'Nepodporovaná metóda.' }, 405);
  }

  if (p === '/api/kreativy') {
    if (req.method === 'GET' && q('klient')) {
      const slug = q('klient');
      const k = SLUG.test(slug) && (await store.get(`kampane/${slug}`, { type: 'json' }));
      if (!k) return json({ chyba: 'Kampaň neexistuje.' }, 404);
      const stav = await stavKampane(stavStore, slug);
      const info = await store.get(`drive/${slug}`, { type: 'json' });
      return json({ kampan: k, stav, drive: info ? { ...info, aktualne: info.ok && info.zmena === poslednaZmena(k, stav) } : null });
    }
    if (req.method === 'GET') {
      const { blobs } = await store.list({ prefix: 'kampane/' });
      const kampane = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean);
      kampane.sort((a, b) => String(b.upravene).localeCompare(String(a.upravene)));
      return json({ kampane });
    }
    if (req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ chyba: 'Neplatné dáta.' }, 400); }
      const klient = txt(b && b.klient, 120);
      if (!klient) return json({ chyba: 'Napíšte názov klienta.' }, 400);
      let slug = slugZ(klient);
      while (klientiZRepa.some((k) => k.slug === slug) || (await store.get(`kampane/${slug}`, { type: 'json' }))) slug = slugZ(klient);
      const { kampan } = vycisti(slug, { klient, kampan: b.kampan, kanal: b.kanal, termin: b.termin, uvod: b.uvod, varianty: [] }, null);
      await store.setJSON(`kampane/${slug}`, kampan);
      return json({ ok: true, kampan }, 201);
    }
    const slug = q('klient');
    if (!SLUG.test(slug || '')) return json({ chyba: 'Neznámy klient.' }, 404);
    const predtym = await store.get(`kampane/${slug}`, { type: 'json' });
    if (!predtym) return json({ chyba: 'Kampaň neexistuje.' }, 404);
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > 500000) return json({ chyba: 'Príliš veľa dát.' }, 413);
      let b; try { b = JSON.parse(text); } catch { return json({ chyba: 'Neplatné dáta.' }, 400); }
      if (b.upravene && predtym.upravene && b.upravene !== predtym.upravene) {
        return json({ chyba: 'Kampaň medzitým upravil niekto iný. Obnovte stránku, vaše zmeny skopírujte znova.', kampan: predtym }, 409);
      }
      const { kampan, zmenene } = vycisti(slug, b, predtym);
      await store.setJSON(`kampane/${slug}`, kampan);
      if (stavStore && zmenene.length) await novaVerzia(stavStore, slug, zmenene, kampan);
      await upratSubory(store, slug, kampan);
      return json({ ok: true, kampan, zmenene });
    }
    if (req.method === 'DELETE') {
      const { blobs } = await store.list({ prefix: `subory/${slug}/` });
      await Promise.all(blobs.map(({ key }) => store.delete(key)));
      await store.delete(`kampane/${slug}`);
      await store.delete(`drive/${slug}`);
      if (stavStore) {
        const s = await stavStore.list({ prefix: slug + '/' });
        await Promise.all(s.blobs.map(({ key }) => stavStore.delete(key)));
      }
      return json({ ok: true });
    }
  }
  return json({ chyba: 'Nepodporovaná metóda.' }, 405);
}

export default async (req, context) =>
  handle(
    req,
    getStore({ name: 'kreativy', consistency: 'strong' }),
    getStore({ name: 'schvalovanie', consistency: 'strong' }),
    context || {},
  );
