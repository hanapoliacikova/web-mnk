// Denník AI videí: projekty tímu v Netlify Blobs (store "dennik"). Všetko len s heslom tímu.
//   GET    /api/dennik              zoznam projektov
//   POST   /api/dennik              {id, data}   nový projekt
//   PATCH  /api/dennik              {id, patch}  zlúčenie zmien do projektu
//   DELETE /api/dennik?id=<id>      zmazanie projektu aj s jeho súbormi
// Súbory k projektu (schválený skript, brief, storyboard…):
//   PUT    /api/dennik/subor?projekt=&id=&cast=&spolu=&velkost=   nahrá kúsok súboru (po 4 MB)
//   POST   /api/dennik/subor    {projekt, id, nazov, faza, popis, kto}        dokončí nahrávanie a zapíše súbor k projektu
//                               {projekt, id, odkaz, nazov, faza, popis, kto} alebo pridá len odkaz (Google Drive a pod.)
//   GET    /api/dennik/subor?projekt=&id=     stiahne súbor
//   DELETE /api/dennik/subor?projekt=&id=     zmaže súbor alebo odkaz
// Obsah súborov je v kľúčoch subory/<projekt>/<id>/c<i>, zoznam v projekte v poli "subory" (objekt podľa id).
import { getStore } from '@netlify/blobs';
import { hesloOk, hesloNastavene } from '../tim-heslo.mjs';
import seed from '../dennik-seed.mjs';

export const config = { path: ['/api/dennik', '/api/dennik/subor'] };

const ID = /^[a-z0-9-]{1,80}$/;
const MAX = 100 * 1024;
export const KUS = 4 * 1024 * 1024; // jeden kúsok súboru, pod limitom 6 MB na požiadavku
const MAX_SUBOR = 200 * 1024 * 1024;
const MAX_SUBOROV = 60;
const FAZY = new Set(['', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']);
// Povolené prípony. HTML, SVG ani skripty sa nenahrávajú, aby sa cez denník nedal podstrčiť kód.
export const TYPY = {
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', rtf: 'application/rtf',
  srt: 'text/plain; charset=utf-8', vtt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pages: 'application/octet-stream', key: 'application/octet-stream', numbers: 'application/octet-stream',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  zip: 'application/zip',
};
const pripona = (n) => (/\.([a-z0-9]{1,8})$/i.exec(String(n || '')) || [])[1]?.toLowerCase() || '';
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function merge(a, b) {
  const out = isObj(a) ? { ...a } : {};
  for (const k of Object.keys(b)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isObj(b[k]) ? merge(out[k], b[k]) : b[k];
  }
  return out;
}

async function zasej(store) {
  if (await store.get('_seed', { type: 'json' })) return;
  for (const p of seed) {
    const { id, ...data } = p;
    if (!(await store.get('projekty/' + id, { type: 'json' }))) await store.setJSON('projekty/' + id, data);
  }
  await store.setJSON('_seed', { cas: new Date().toISOString() });
}

export async function handle(req, store) {
  if (!hesloNastavene()) return json({ chyba: 'Heslo tímu nie je nastavené v Netlify (premenná TIM_HESLO).' }, 503);
  if (!hesloOk(req.headers.get('x-heslo'))) return json({ chyba: 'Nesprávne heslo.' }, 401);
  const url = new URL(req.url);
  if (url.pathname.replace(/\/+$/, '') === '/api/dennik/subor') return subor(req, url, store);

  if (req.method === 'GET') {
    await zasej(store);
    const { blobs } = await store.list({ prefix: 'projekty/' });
    const projekty = (await Promise.all(blobs.map(async ({ key }) => {
      const d = await store.get(key, { type: 'json' });
      return d ? { ...d, id: key.slice('projekty/'.length) } : null;
    }))).filter(Boolean);
    return json({ projekty });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json({ chyba: 'Neplatné id.' }, 400);
    await store.delete('projekty/' + id);
    const { blobs } = await store.list({ prefix: `subory/${id}/` });
    await Promise.all(blobs.map(({ key }) => store.delete(key)));
    return json({ ok: true });
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    const text = await req.text();
    if (text.length > MAX) return json({ chyba: 'Príliš veľa dát.' }, 413);
    let b;
    try { b = JSON.parse(text); } catch { return json({ chyba: 'Neplatné dáta.' }, 400); }
    const id = b && b.id;
    if (!ID.test(id || '')) return json({ chyba: 'Neplatné id.' }, 400);
    const key = 'projekty/' + id;
    if (req.method === 'POST') {
      if (!isObj(b.data)) return json({ chyba: 'Chýbajú dáta projektu.' }, 400);
      const data = merge({}, b.data);
      await store.setJSON(key, data);
      return json({ ok: true, id });
    }
    if (!isObj(b.patch)) return json({ chyba: 'Chýbajú zmeny.' }, 400);
    const predtym = await store.get(key, { type: 'json' });
    if (!predtym) return json({ chyba: 'Projekt neexistuje.' }, 404);
    const novy = merge(predtym, b.patch);
    if (JSON.stringify(novy).length > MAX) return json({ chyba: 'Projekt je príliš veľký.' }, 413);
    await store.setJSON(key, novy);
    return json({ ok: true });
  }

  return json({ chyba: 'Nepodporovaná metóda.' }, 405);
}

async function zmazObsah(store, projekt, id) {
  const { blobs } = await store.list({ prefix: `subory/${projekt}/${id}/` });
  await Promise.all(blobs.map(({ key }) => store.delete(key)));
}

async function subor(req, url, store) {
  const q = (k) => url.searchParams.get(k);
  const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
  const projekt = body ? body.projekt : q('projekt');
  const id = body ? body.id : q('id');
  if (!ID.test(projekt || '') || !ID.test(id || '')) return json({ chyba: 'Neplatné id.' }, 400);
  const key = 'projekty/' + projekt;
  const p = await store.get(key, { type: 'json' });
  if (!p) return json({ chyba: 'Projekt neexistuje.' }, 404);
  const zoznam = isObj(p.subory) ? p.subory : {};

  if (req.method === 'PUT') {
    const cast = Number(q('cast')), spolu = Number(q('spolu')), velkost = Number(q('velkost'));
    if (velkost > MAX_SUBOR) return json({ chyba: 'Súbor je väčší ako 200 MB. Dajte ho na Google Drive a pridajte odkaz.' }, 413);
    if (!Number.isInteger(cast) || !Number.isInteger(spolu) || cast < 0 || cast >= spolu || !(velkost > 0) || spolu !== Math.ceil(velkost / KUS)) {
      return json({ chyba: 'Neplatné údaje o súbore.' }, 400);
    }
    if (zoznam[id] && zoznam[id].velkost) return json({ chyba: 'Súbor už existuje.' }, 409);
    const buf = await req.arrayBuffer();
    const ocakavane = cast < spolu - 1 ? KUS : velkost - KUS * (spolu - 1);
    if (buf.byteLength !== ocakavane) return json({ chyba: 'Kúsok súboru nemá správnu veľkosť.' }, 400);
    await store.set(`subory/${projekt}/${id}/c${cast}`, buf);
    return json({ ok: true });
  }

  if (req.method === 'POST') {
    if (!body) return json({ chyba: 'Neplatné dáta.' }, 400);
    if (Object.keys(zoznam).length >= MAX_SUBOROV) return json({ chyba: 'Projekt má už priveľa súborov.' }, 413);
    if (zoznam[id]) return json({ chyba: 'Súbor už existuje.' }, 409);
    const zaznam = {
      nazov: txt(body.nazov, 160),
      faza: FAZY.has(body.faza) ? body.faza : '',
      popis: txt(body.popis, 300),
      kto: txt(body.kto, 80),
      cas: new Date().toISOString(),
    };
    if (body.odkaz) {
      let u;
      try { u = new URL(String(body.odkaz)); } catch { return json({ chyba: 'Neplatný odkaz.' }, 400); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return json({ chyba: 'Odkaz musí začínať https://' }, 400);
      zaznam.odkaz = u.href.slice(0, 1000);
      zaznam.nazov = zaznam.nazov || u.hostname;
    } else {
      const ext = pripona(zaznam.nazov);
      if (!TYPY[ext]) return json({ chyba: 'Tento typ súboru sa nedá nahrať.' }, 400);
      const velkost = Number(body.velkost);
      const spolu = Math.ceil(velkost / KUS);
      if (!(velkost > 0) || velkost > MAX_SUBOR) return json({ chyba: 'Neplatná veľkosť súboru.' }, 400);
      const { blobs } = await store.list({ prefix: `subory/${projekt}/${id}/c` });
      if (blobs.length !== spolu) return json({ chyba: 'Súbor sa nenahral celý, skúste to znova.' }, 409);
      zaznam.typ = TYPY[ext];
      zaznam.velkost = velkost;
      zaznam.casti = spolu;
    }
    // projekt prečítame znova tesne pred zápisom, aby sa nestratili súčasné zmeny
    const aktualny = (await store.get(key, { type: 'json' })) || p;
    const novy = merge(aktualny, { subory: { [id]: zaznam }, upravene: new Date().toISOString() });
    if (JSON.stringify(novy).length > MAX) return json({ chyba: 'Projekt je príliš veľký.' }, 413);
    await store.setJSON(key, novy);
    return json({ ok: true, id, subor: zaznam }, 201);
  }

  if (req.method === 'DELETE') {
    await zmazObsah(store, projekt, id);
    const aktualny = (await store.get(key, { type: 'json' })) || p;
    if (isObj(aktualny.subory)) { delete aktualny.subory[id]; await store.setJSON(key, aktualny); }
    return json({ ok: true });
  }

  if (req.method === 'GET') {
    const z = zoznam[id];
    if (!z || !z.velkost) return json({ chyba: 'Súbor sa nenašiel.' }, 404);
    const meno = z.nazov || 'subor';
    const ascii = meno.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '_');
    const hlavicky = {
      'Content-Type': z.typ || 'application/octet-stream',
      'Content-Length': String(z.velkost),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meno)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    };
    let i = 0;
    const stream = new ReadableStream({
      async pull(ctrl) {
        if (i >= z.casti) { ctrl.close(); return; }
        const buf = await store.get(`subory/${projekt}/${id}/c${i++}`, { type: 'arrayBuffer' });
        if (!buf) { ctrl.error(new Error('Chýba časť súboru.')); return; }
        ctrl.enqueue(new Uint8Array(buf));
      },
    });
    return new Response(stream, { status: 200, headers: hlavicky });
  }

  return json({ chyba: 'Nepodporovaná metóda.' }, 405);
}

export default async (req) => handle(req, getStore({ name: 'dennik', consistency: 'strong' }));
