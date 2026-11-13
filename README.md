# marketingnakluc.sk

Statický web Marketing na kľúč. Žiadny build, čisté HTML a CSS.

## Štruktúra

| Stránka | Súbor |
|---|---|
| Domov | `index.html` |
| Ako pracujeme s AI | `ako-pracujeme-s-ai/index.html` |
| MNK Studio | `studio/index.html` |
| Filmový marketing | `filmovy-marketing/index.html` |
| Tím | `tim/index.html` |
| Poďakovanie po odoslaní formulára | `dakujeme/index.html` |

Štýly sú v `assets/css/style.css` (farby ako premenné na začiatku), skript pre mobilné menu a filter portfólia v `assets/js/main.js`, fotky a logo v `assets/img/`.

Menu a pätička sú v každej stránke rovnaké. Pri zmene ich treba upraviť vo všetkých `index.html`.

## Lokálny náhľad

```
python3 -m http.server 8000
```

a otvoriť http://localhost:8000.

## Hosting

Pripravené pre Netlify (`netlify.toml`, kontaktný formulár cez Netlify Forms). Publikuje sa koreňový priečinok bez buildu.

## Písma a logo

Nadpisy Bebas Neue, text Inter (Google Fonts). Logo je obrázok, písmo loga (Coves) má len osobnú licenciu a na webe sa ako font nepoužíva.

## Česká verzia (marketingnaklic.cz)

Česká verzia je v priečinku `/cz` a generuje sa zo slovenských stránok:

```
python3 tools/cz/build.py
```

Preklady sú v `tools/cz/preklad.json`. Po každej zmene slovenského textu doplň preklad a spusti skript znova. Text bez prekladu skript vypíše a v českej verzii ostane po slovensky. Doména marketingnaklic.cz sa na `/cz` mapuje v `netlify.toml`.

## Schvaľovanie kreatív (marketingnakluc.sk/schvalovanie/…)

Každý klient má vlastnú tajnú adresu, napríklad `/schvalovanie/ukazka-7f3k/`. Klient pri každom variante klikne Schváliť alebo Upraviť s poznámkou. Tím vidí všetkých klientov na `/schvalovanie/prehlad/` (heslo).

**Nový klient alebo nové kolo kreatív**

1. Vytvoriť priečinok `schvalovanie/<klient>-<náhodný kód>/` (napr. `bartos-k7q2`, len malé písmená, čísla a pomlčky).
2. Do neho dať obrázky (JPG, PNG, WEBP, SVG) alebo videá (MP4) a súbor `kampan.json` podľa vzoru v `schvalovanie/ukazka-7f3k/kampan.json`. Karusel = viac súborov v `obrazky`.
3. Pridať klienta do `netlify/schvalovanie-klienti.mjs`. Bez toho klient nemôže nič uložiť.
4. Po nasadení poslať klientovi odkaz.

Nové kolo: pridať varianty s novým `id` (napr. `a2`), staré rozhodnutia ostanú uložené.

**Technika:** spoločná stránka `schvalovanie/_stranka.html` + `app.js` + `app.css` (presmerovanie v `netlify.toml`). Stav sa ukladá cez Netlify Function `netlify/functions/schvalovanie.mjs` do Netlify Blobs (store `schvalovanie`). Heslo prehľadu je premenná prostredia `TIM_HESLO` v Netlify (spoločná pre všetky interné stránky) (Site configuration, Environment variables). Stránky majú noindex a sú vylúčené v `robots.txt`.

## Interné nástroje tímu (marketingnakluc.sk/interne/)

Rozcestník `/interne/` vedie na Prehľad schvaľovania a na **Denník AI videí** (`/interne/dennik-ai-videi/`). Denník je prenesený z artefaktu v Claude: projekty, hodiny, kredity a kroky po fázach sa ukladajú cez `netlify/functions/dennik.mjs` do Netlify Blobs (store `dennik`). Projekty z pôvodného artefaktu sa zapíšu pri prvom otvorení (`netlify/dennik-seed.mjs`).

Všetky interné stránky chráni jedno heslo tímu, premenná `TIM_HESLO` v Netlify. Majú noindex a sú vylúčené v `robots.txt`; nikam z verejného webu na ne nevedie odkaz.
