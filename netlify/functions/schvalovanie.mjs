// Ukladanie schvaľovania kreatív do Netlify Blobs.
//   GET  /api/schvalovanie?klient=<slug>       stav jedného klienta (verejné, slug je tajný odkaz)
//   POST /api/schvalovanie                     {klient, variant, status, poznamka, meno}
//   GET  /api/schvalovanie/prehlad             všetci klienti, hlavička x-heslo = TIM_HESLO
// Klient je buď v repe (netlify/schvalovanie-klienti.mjs + priečinok), alebo ho tím založil
// cez /interne/kreativy/ (kampaň v Netlify Blobs, store "kreativy").
import { getStore } from '@netlify/blobs';
import { hesloOk, hesloNastavene } from '../tim-heslo.mjs';
import klienti from '../schvalovanie-klienti.mjs';

const STATUSY = ['schvalene', 'uprava', 'caka'];
const ID = /^[a-z0-9-]{1,60}$/;

export const config = { path: ['/api/schvalovanie', '/api/schvalovanie/prehlad'] };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });

async function znamy(slug, kStore) {
  if (!ID.test(slug || '')) return false;
  if (klienti.some((k) => k.slug === slug)) return true;
  return Boolean(kStore && (await kStore.get(`kampane/${slug}`, { type: 'json' })));
}

async function vsetciKlienti(kStore) {
  const zoznam = klienti.map((k) => ({ ...k }));
  if (kStore) {
    const { blobs } = await kStore.list({ prefix: 'kampane/' });
    const kampane = (await Promise.all(blobs.map(({ key }) => kStore.get(key, { type: 'json' })))).filter(Boolean);
    kampane.sort((a, b) => String(b.upravene).localeCompare(String(a.upravene)));
    kampane.forEach((k) => zoznam.unshift({ slug: k.slug, klient: k.klient, kampanData: k }));
  }
  return zoznam;
}

async function stavKlienta(store, slug) {
  const { blobs } = await store.list({ prefix: slug + '/' });
  const stav = {};
  await Promise.all(blobs.map(async ({ key }) => {
    const z = await store.get(key, { type: 'json' });
    if (z) stav[key.slice(slug.length + 1)] = z;
  }));
  return stav;
}

export async function handle(req, store, kStore) {
  const url = new URL(req.url);

  if (url.pathname.endsWith('/prehlad')) {
    if (req.method !== 'GET') return json({ chyba: 'Nepodporovaná metóda.' }, 405);
    if (!hesloNastavene()) return json({ chyba: 'Heslo tímu nie je nastavené v Netlify (premenná TIM_HESLO).' }, 503);
    if (!hesloOk(req.headers.get('x-heslo'))) return json({ chyba: 'Nesprávne heslo.' }, 401);
    const zoznam = await Promise.all((await vsetciKlienti(kStore)).map(async (k) => ({ ...k, stav: await stavKlienta(store, k.slug) })));
    return json({ klienti: zoznam });
  }

  if (req.method === 'GET') {
    const slug = url.searchParams.get('klient');
    if (!(await znamy(slug, kStore))) return json({ chyba: 'Neznámy klient.' }, 404);
    return json({ stav: await stavKlienta(store, slug) });
  }

  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { return json({ chyba: 'Neplatné dáta.' }, 400); }
    const { klient, variant, status } = b || {};
    if (!(await znamy(klient, kStore))) return json({ chyba: 'Neznámy klient.' }, 404);
    if (!ID.test(variant || '') || !STATUSY.includes(status)) return json({ chyba: 'Neplatný variant alebo stav.' }, 400);
    const poznamka = String(b.poznamka || '').trim().slice(0, 2000);
    const meno = String(b.meno || '').trim().slice(0, 80);
    if (status === 'uprava' && !poznamka) return json({ chyba: 'Pri úprave chýba poznámka.' }, 400);
    const key = `${klient}/${variant}`;
    const predtym = (await store.get(key, { type: 'json' })) || {};
    const zaznam = { status, poznamka, meno, cas: new Date().toISOString() };
    const historia = (Array.isArray(predtym.historia) ? predtym.historia : []).concat([zaznam]).slice(-30);
    const ulozit = { ...zaznam, historia };
    await store.setJSON(key, ulozit);
    return json({ ok: true, zaznam: ulozit });
  }

  return json({ chyba: 'Nepodporovaná metóda.' }, 405);
}

export default async (req) =>
  handle(req, getStore({ name: 'schvalovanie', consistency: 'strong' }), getStore({ name: 'kreativy', consistency: 'strong' }));
