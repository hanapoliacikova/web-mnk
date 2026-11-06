// Mobilné menu
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('menu');
if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

// Zoradenie portfólia podľa formátu: rovnaké formáty idú spolu, aby boli v riadku zarovnané.
// Funguje automaticky aj pre nové položky: formát sa zistí z width/height (alebo z načítaného obrázka).
const FORMATY = [
  { id: 'vyska-9-16', ar: 9 / 16, od: 0, do: 0.62, min: '200px' },
  { id: 'vyska-4-5', ar: 4 / 5, od: 0.62, do: 0.9, min: '220px' },
  { id: 'stvorec', ar: 1, od: 0.9, do: 1.15, min: '220px' },
  { id: 'sirka-3-2', ar: 3 / 2, od: 1.15, do: 1.65, min: '300px' },
  { id: 'sirka-16-9', ar: 16 / 9, od: 1.65, do: 1.9, min: '300px' },
  { id: 'panorama', ar: 5 / 2, od: 1.9, do: Infinity, min: '420px' },
];
const port = document.querySelector('.port');
function pomerMedia(el) {
  const w = +el.getAttribute('width'), h = +el.getAttribute('height');
  if (w && h) return Promise.resolve(w / h);
  return new Promise((ok) => {
    const src = el.tagName === 'VIDEO' ? el.poster : el.currentSrc || el.src;
    if (!src) return ok(1);
    const i = new Image();
    i.onload = () => ok(i.naturalWidth / i.naturalHeight || 1);
    i.onerror = () => ok(1);
    i.src = src;
  });
}
function zoskupPortfolio() {
  if (!port) return Promise.resolve();
  const polozky = [...port.querySelectorAll(':scope > .port__item')];
  return Promise.all(polozky.map((it) => {
    const m = it.querySelector('img, video');
    return m ? pomerMedia(m) : Promise.resolve(1);
  })).then((pomery) => {
    const skupiny = FORMATY.map((f) => {
      const g = document.createElement('div');
      g.className = 'port__group';
      g.dataset.format = f.id;
      g.style.setProperty('--min', f.min);
      g.style.setProperty('--ar', String(f.ar));
      return g;
    });
    polozky.forEach((it, i) => {
      const r = pomery[i];
      const k = FORMATY.findIndex((f) => r >= f.od && r < f.do);
      const f = FORMATY[k];
      // Ak sa skutočný pomer líši od rámu o viac ako 4 %, obsah sa neoreže, ale zmestí celý.
      it.classList.toggle('is-contain', Math.abs(r / f.ar - 1) > 0.04);
      const m = it.querySelector('img, video');
      if (m) m.style.removeProperty('aspect-ratio');
      skupiny[k].appendChild(it);
    });
    skupiny.forEach((g) => { if (g.children.length) port.appendChild(g); });
    port.classList.add('is-grouped');
  });
}
const zoskupene = zoskupPortfolio();

// Filter portfólia v MNK Studiu
const filter = document.querySelector('[data-filter]');
if (filter) {
  filter.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const kat = btn.dataset.value;
    zoskupene.then(() => {
      document.querySelectorAll('[data-kat]').forEach((it) => {
        it.hidden = kat !== 'vsetko' && !it.dataset.kat.split(' ').includes(kat);
      });
      document.querySelectorAll('.port__group').forEach((g) => {
        g.hidden = !g.querySelector('.port__item:not([hidden])');
      });
    });
  });
}

// Videá v portfóliu sa prehrávajú, len keď sú na obrazovke
const videa = document.querySelectorAll('video[muted]');
if (videa.length && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((zaznamy) => {
    zaznamy.forEach((z) => {
      const v = z.target;
      if (z.isIntersecting && !v.closest('[hidden]')) { v.play().catch(() => {}); } else { v.pause(); }
    });
  }, { threshold: 0.4 });
  videa.forEach((v) => io.observe(v));
}
