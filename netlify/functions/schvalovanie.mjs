// Ukladanie schvaľovania kreatív do Netlify Blobs.
//   GET  /api/schvalovanie?klient=<slug>       stav jedného klienta (verejné, slug je tajný odkaz)
//   POST /api/schvalovanie                     {klient, variant, status, poznamka, meno}
//   GET  /api/schvalovanie/prehlad             všetci klienti, hlavička x-heslo = TIM_HESLO
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

const znamy = (slug) => ID.test(slug || '') && klienti.some((k) => k.slug === slug);

async function stavKlienta(store, slug) {
  const { blobs } = await store.list({ prefix: slug + '/' });
  const stav = {};
  await Promise.all(blobs.map(async ({ key }) => {
    const z = await store.get(key, { type: 'json' });
    if (z) stav[key.slice(slug.length + 1)] = z;
  }));
  return stav;
}

export async function handle(req, store) {
  const url = new URL(req.url);

  if (url.pathname.endsWith('/prehlad')) {
    if (req.method !== 'GET') return json({ chyba: 'Nepodporovaná metóda.' }, 405);
    if (!hesloNastavene()) return json({ chyba: 'Heslo tímu nie je nastavené v Netlify (premenná TIM_HESLO).' }, 503);
    if (!hesloOk(req.headers.get('x-heslo'))) return json({ chyba: 'Nesprávne heslo.' }, 401);
    const zoznam = await Promise.all(klienti.map(async (k) => ({ ...k, stav: await stavKlienta(store, k.slug) })));
    return json({ klienti: zoznam });
  }

  if (req.method === 'GET') {
    const slug = url.searchParams.get('klient');
    if (!znamy(slug)) return json({ chyba: 'Neznámy klient.' }, 404);
    return json({ stav: await stavKlienta(store, slug) });
  }

  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { return json({ chyba: 'Neplatné dáta.' }, 400); }
    const { klient, variant, status } = b || {};
    if (!znamy(klient)) return json({ chyba: 'Neznámy klient.' }, 404);
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

export default async (req) => handle(req, getStore({ name: 'schvalovanie', consistency: 'strong' }));
