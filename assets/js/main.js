// Mobilné menu
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('menu');
if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

// Filter portfólia v MNK Studiu
const filter = document.querySelector('[data-filter]');
if (filter) {
  const items = document.querySelectorAll('[data-kat]');
  filter.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const kat = btn.dataset.value;
    items.forEach((it) => {
      it.hidden = kat !== 'vsetko' && !it.dataset.kat.split(' ').includes(kat);
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
