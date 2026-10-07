// --- Page d'accueil : carrousel 3D du Codex, rail latéral ---

// ---------- Carrousel 3D ----------
(function(){
  const root = document.getElementById('codexCarousel');
  if(!root) return;

  const stage = root.querySelector('.cf-stage');
  const cards = Array.from(root.querySelectorAll('.cf-card'));
  const dotsWrap = root.querySelector('.cf-dots');
  const dockMain = root.querySelector('.cf-dock-main');
  const dockThumb = root.querySelector('.cf-dock-thumb');
  const dockName = root.querySelector('.cf-dock-name');
  const dockSub = root.querySelector('.cf-dock-sub');
  const n = cards.length;
  const pad = (x) => String(x).padStart(2, '0');
  let active = 0;

  // Position des cartes selon leur distance au centre (en largeurs de carte)
  const LAYOUT = {
    wide:   { x:[0, 0.78, 1.12, 1.4], z:[0, -150, -270, -370], lum:[1, 0.78, 0.62, 0.5], visible:3 },
    narrow: { x:[0, 0.62, 0.86, 1.0],  z:[0, -150, -270, -370], lum:[1, 0.75, 0.6, 0.5],  visible:2 }
  };
  const TILT = 36; // inclinaison des cartes latérales (deg)

  function mountains(i){
    const g = (id, top, bottom) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--c)" stop-opacity="${top}"/><stop offset="1" stop-color="var(--c)" stop-opacity="${bottom}"/></linearGradient>`;
    return `<svg class="cf-peaks" viewBox="0 0 300 440" preserveAspectRatio="none" aria-hidden="true"><defs>${g('p'+i+'a', 0.55, 0)}${g('p'+i+'b', 0.4, 0.04)}</defs>` +
      `<polygon fill="url(#p${i}a)" points="0,440 0,230 28,150 52,215 82,95 112,200 142,40 172,190 204,105 234,210 262,130 300,225 300,440"/>` +
      `<polygon fill="url(#p${i}b)" points="0,440 0,300 38,205 66,275 100,170 132,285 162,140 196,275 228,185 262,295 300,220 300,440"/>` +
      `<polygon class="cf-peaks-front" points="0,440 0,365 34,305 60,350 96,272 126,352 166,292 200,362 240,302 270,350 300,322 300,440"/></svg>`;
  }

  cards.forEach((card, i) => {
    card.querySelector('.cf-count').textContent = pad(i + 1) + ' / ' + pad(n);
    const sub = document.createElement('p');
    sub.className = 'cf-sub';
    sub.textContent = card.dataset.sub || '';
    card.querySelector('.cf-head').after(sub);
    card.setAttribute('draggable', 'false');

    // Paysage de montagnes dessiné, teinté par la couleur de la catégorie
    card.querySelector('.cf-art').insertAdjacentHTML('afterbegin', mountains(i));

    // .cf-inner porte le visuel : la coque garde la position 3D,
    // l'intérieur peut osciller et suivre la souris sans conflit
    const inner = document.createElement('div');
    inner.className = 'cf-inner';
    while(card.firstChild) inner.appendChild(card.firstChild);
    const sheen = document.createElement('span');
    sheen.className = 'cf-sheen';
    inner.appendChild(sheen);
    const dim = document.createElement('span');
    dim.className = 'cf-dim';
    inner.appendChild(dim);
    card.appendChild(inner);
  });

  const dots = cards.map((card, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', card.querySelector('h3').textContent);
    b.addEventListener('click', () => go(i));
    dotsWrap.appendChild(b);
    return b;
  });

  function render(){
    const L = window.innerWidth < 600 ? LAYOUT.narrow : LAYOUT.wide;
    cards.forEach((card, i) => {
      let d = ((i - active) % n + n) % n;
      if(d > n / 2) d -= n;
      const abs = Math.abs(d);
      const k = Math.min(abs, L.x.length - 1);
      const side = Math.sign(d);
      card.style.setProperty('--x', side * L.x[k]);
      card.style.setProperty('--z', L.z[k] + 'px');
      card.style.setProperty('--ry', (side * -TILT) + 'deg');
      card.style.setProperty('--lum', L.lum[k]);
      card.style.setProperty('--abs', abs);
      card.style.zIndex = 100 - abs;
      card.classList.toggle('is-active', d === 0);
      card.classList.toggle('is-right', d > 0);
      card.classList.toggle('is-hidden', abs > L.visible);
      card.tabIndex = d === 0 ? 0 : -1;
      card.setAttribute('aria-hidden', abs > L.visible ? 'true' : 'false');
    });
    dots.forEach((b, i) => b.setAttribute('aria-selected', i === active ? 'true' : 'false'));

    const cur = cards[active];
    root.style.setProperty('--ac', cur.style.getPropertyValue('--c'));
    dockMain.href = cur.getAttribute('href');
    dockThumb.innerHTML = cur.querySelector('.cf-icon').innerHTML;
    dockName.textContent = cur.querySelector('h3').textContent;
    dockSub.textContent = 'Section ' + (active + 1) + ' sur ' + n;
  }

  function go(i){
    const next = ((i % n) + n) % n;
    if(next === active) return;
    // sens du mouvement (chemin le plus court)
    let delta = ((next - active) % n + n) % n;
    if(delta > n / 2) delta -= n;
    resetTilt(cards[active]);
    active = next;
    render();

    // la carte qui arrive au centre oscille, et un éclat la traverse
    cards.forEach(c => c.classList.remove('swing-next', 'swing-prev'));
    const card = cards[active];
    void card.offsetWidth; // relance l'animation
    card.classList.add(delta > 0 ? 'swing-next' : 'swing-prev');
  }
  cards.forEach(card => {
    card.addEventListener('animationend', (e) => {
      if(e.target.classList.contains('cf-inner')) card.classList.remove('swing-next', 'swing-prev');
    });
  });

  root.querySelectorAll('.cf-arrow').forEach(btn => {
    btn.addEventListener('click', () => go(active + Number(btn.dataset.dir)));
  });

  // Clic sur une carte latérale : on la ramène au centre au lieu de naviguer
  let dragged = false;
  cards.forEach((card, i) => {
    card.addEventListener('click', (e) => {
      if(dragged || i !== active){
        e.preventDefault();
        if(!dragged) go(i);
      }
    });
  });

  stage.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowLeft'){ e.preventDefault(); go(active - 1); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); go(active + 1); }
  });

  // Glisser (souris ou doigt) : les cartes défilent en direct pendant le geste
  let startX = null;
  stage.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    dragged = false;
  });
  window.addEventListener('pointermove', (e) => {
    if(startX === null) return;
    const step = cards[active].offsetWidth * 0.45;
    const dx = e.clientX - startX;
    if(Math.abs(dx) > step){
      dragged = true;
      go(active + (dx < 0 ? 1 : -1));
      startX += dx < 0 ? -step : step;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if(startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if(!dragged && Math.abs(dx) > 30){ dragged = true; go(active + (dx < 0 ? 1 : -1)); }
    // le clic qui suit le relâchement ne doit pas ouvrir la carte
    if(dragged) setTimeout(() => { dragged = false; }, 0);
  });
  window.addEventListener('pointercancel', () => { startX = null; });

  // Molette horizontale / pavé tactile (ou Maj + molette)
  let wheelAcc = 0, wheelLock = 0;
  stage.addEventListener('wheel', (e) => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if(!dx) return; // défilement vertical : on laisse la page descendre
    e.preventDefault();
    const now = performance.now();
    if(now < wheelLock) return;
    wheelAcc += dx;
    if(Math.abs(wheelAcc) > 40){
      go(active + (wheelAcc > 0 ? 1 : -1));
      wheelAcc = 0;
      wheelLock = now + 140;
    }
  }, { passive:false });

  // Inclinaison de la carte centrale qui suit la souris
  function resetTilt(card){
    const inner = card.querySelector('.cf-inner');
    card.classList.remove('is-tilting');
    inner.style.setProperty('--tx', '0deg');
    inner.style.setProperty('--ty', '0deg');
    inner.style.setProperty('--mx', '50%');
    inner.style.setProperty('--my', '30%');
  }
  let tiltFrame = 0, lastMove = null;
  stage.addEventListener('pointermove', (e) => {
    if(e.pointerType !== 'mouse' || startX !== null) return;
    lastMove = e;
    if(!tiltFrame) tiltFrame = requestAnimationFrame(applyTilt);
  });
  function applyTilt(){
    tiltFrame = 0;
    const e = lastMove;
    const card = cards[active];
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if(x < 0 || x > 1 || y < 0 || y > 1){ resetTilt(card); return; }
    const inner = card.querySelector('.cf-inner');
    card.classList.add('is-tilting');
    inner.style.setProperty('--tx', ((0.5 - y) * 12).toFixed(2) + 'deg');
    inner.style.setProperty('--ty', ((x - 0.5) * 16).toFixed(2) + 'deg');
    inner.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    inner.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  }
  stage.addEventListener('pointerleave', () => resetTilt(cards[active]));

  window.addEventListener('resize', render);
  render();
})();

// ---------- Défilement : fond flouté, topbar, rail latéral ----------
(function(){
  const body = document.body;
  const blurLayer = document.querySelector('.page-bg-blur');
  let ticking = false, lastOpacity = -1, lastScrolled = null;

  function onScroll(){
    ticking = false;
    const h = window.innerHeight;
    const y = window.scrollY;
    const op = Math.round(Math.min(1, y / (h * 0.7)) * 100) / 100;
    if(blurLayer && op !== lastOpacity){ blurLayer.style.opacity = op; lastOpacity = op; }
    const scrolled = y > h * 0.5;
    if(scrolled !== lastScrolled){ body.classList.toggle('scrolled', scrolled); lastScrolled = scrolled; }
  }
  window.addEventListener('scroll', () => {
    if(!ticking){ ticking = true; requestAnimationFrame(onScroll); }
  }, { passive:true });
  onScroll();

  const links = Array.from(document.querySelectorAll('.side-rail a[data-section]'));
  if(!links.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      links.forEach(a => a.classList.toggle('active', a.dataset.section === entry.target.id));
    });
  }, { rootMargin:'-45% 0px -45% 0px' });
  links.forEach(a => {
    const sec = document.getElementById(a.dataset.section);
    if(sec) io.observe(sec);
  });
})();

// ---------- Apparitions au défilement ----------
(function(){
  const items = Array.from(document.querySelectorAll('[data-reveal]'));
  if(!items.length) return;

  function reveal(el){
    el.classList.add('is-in');
    // Carrousel : décalage en cascade seulement pendant l'apparition,
    // pour que la navigation reste vive ensuite
    if(el.classList.contains('cf')){
      el.classList.add('revealing');
      setTimeout(() => el.classList.remove('revealing'), 1800);
    }
  }

  if(!('IntersectionObserver' in window)){ items.forEach(reveal); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      reveal(entry.target);
      io.unobserve(entry.target);
    });
  }, { threshold:0.18, rootMargin:'0px 0px -8% 0px' });
  items.forEach(el => io.observe(el));
})();
