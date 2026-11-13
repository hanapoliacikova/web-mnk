// Denník AI videí: projekty tímu v Netlify Blobs (store "dennik"). Všetko len s heslom tímu.
//   GET    /api/dennik              zoznam projektov
//   POST   /api/dennik              {id, data}   nový projekt
//   PATCH  /api/dennik              {id, patch}  zlúčenie zmien do projektu
//   DELETE /api/dennik?id=<id>      zmazanie projektu
import { getStore } from '@netlify/blobs';
import { hesloOk, hesloNastavene } from '../tim-heslo.mjs';
import seed from '../dennik-seed.mjs';

export const config = { path: '/api/dennik' };

const ID = /^[a-z0-9-]{1,80}$/;
const MAX = 100 * 1024;

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

export default async (req) => handle(req, getStore({ name: 'dennik', consistency: 'strong' }));
