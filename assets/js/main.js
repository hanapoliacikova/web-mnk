// Mobilné menu
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('menu');
if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

// Portfólio v MNK Studiu: jeden vodorovný pás. Všetky položky majú rovnakú výšku,
// šírka sa dopočíta z pomeru strán (width/height alebo načítaný obrázok), takže sú zarovnané zhora aj zdola.
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
if (port) {
  port.querySelectorAll('.port__item').forEach((it) => {
    const m = it.querySelector('img, video');
    if (!m) return;
    m.style.removeProperty('aspect-ratio');
    pomerMedia(m).then((r) => it.style.setProperty('--r', String(Math.min(Math.max(r, 0.5), 2.4))));
  });
  document.querySelectorAll('.port-sipka').forEach((b) => b.addEventListener('click', () => {
    port.scrollBy({ left: +b.dataset.smer * port.clientWidth * 0.8, behavior: 'smooth' });
  }));
}

// Filter portfólia
const filter = document.querySelector('[data-filter]');
if (filter && port) {
  filter.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const kat = btn.dataset.value;
    port.querySelectorAll('[data-kat]').forEach((it) => {
      it.hidden = kat !== 'vsetko' && !it.dataset.kat.split(' ').includes(kat);
    });
    port.scrollTo({ left: 0 });
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

// Pohyblivý pás plagátov: obsah sa zdvojí, aby pás bežal plynulo dokola
document.querySelectorAll('[data-pas] .pas__track').forEach((t) => {
  const povodne = [...t.children];
  povodne.forEach((el) => {
    const k = el.cloneNode(true);
    k.setAttribute('aria-hidden', 'true');
    k.querySelectorAll('img').forEach((i) => { i.alt = ''; });
    t.appendChild(k);
  });
  t.style.setProperty('--pas-cas', povodne.length * 7 + 's');
});
