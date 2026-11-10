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
