/* =========================================================================
   MADARA — 終わりなき夢
   Motion stack: GSAP + ScrollTrigger + Lenis (the single smooth-scroll engine).
   Frame work is canvas 2D — one rAF, DPR-capped, paused when hidden.
   ========================================================================= */

(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COARSE  = window.matchMedia('(hover:none), (pointer:coarse)').matches;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp  = (a, b, t) => a + (b - a) * t;

  const SEQ = {
    turn:   { dir: 'assets/frames/turn',   prefix: 'turn',   count: 70 },
    awaken: { dir: 'assets/frames/awaken', prefix: 'awaken', count: 38 }
  };

  /* ======================================================================
     1 · FRAME LOADING — real progress, feeding the preloader
     ====================================================================== */

  const frames = { turn: [], awaken: [] };

  function loadSequence(key, onTick) {
    const { dir, prefix, count } = SEQ[key];
    const list = new Array(count);
    let settled = 0;
    return Promise.all(
      Array.from({ length: count }, (_, i) => new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        const done = (ok) => {
          list[i] = ok ? img : null;
          settled++; onTick && onTick();
          resolve();
        };
        img.onload = () => done(true);
        img.onerror = () => done(false);          // a missing frame is skipped, never fatal
        img.src = `${dir}/${prefix}_${String(i + 1).padStart(3, '0')}.webp`;
      }))
    ).then(() => {
      frames[key] = list;
      return settled;
    });
  }

  /* nearest frame that actually decoded — keeps a gap from blanking the canvas */
  function frameAt(key, index) {
    const list = frames[key];
    if (!list.length) return null;
    const i = clamp(Math.round(index), 0, list.length - 1);
    if (list[i]) return list[i];
    for (let d = 1; d < list.length; d++) {
      if (list[i - d]) return list[i - d];
      if (list[i + d]) return list[i + d];
    }
    return null;
  }

  /* draw an image as background-size:cover into a DPR-scaled canvas */
  function drawCover(ctx, img, w, h, scale = 1, offX = 0, offY = 0) {
    if (!img || !img.naturalWidth) return;
    const r = Math.max(w / img.naturalWidth, h / img.naturalHeight) * scale;
    const dw = img.naturalWidth * r;
    const dh = img.naturalHeight * r;
    ctx.drawImage(img, (w - dw) / 2 + offX, (h - dh) / 2 + offY, dw, dh);
  }

  function fitCanvas(canvas, maxBackingWidth) {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    /* The frame sequences are 1280x720. Rendering them into a 2880px-wide
       buffer upscales well past the source for no visible gain and triples the
       fill cost, which is what makes a per-frame cross-fade expensive. */
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (maxBackingWidth) dpr = Math.min(dpr, maxBackingWidth / w);
    dpr = Math.max(dpr, 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    return { ctx, w, h };
  }

  /* ======================================================================
     2 · PRELOADER
     ====================================================================== */

  const loaderEl  = $('[data-preloader]');
  const loaderBar = $('[data-preloader-bar]');
  const loaderPct = $('[data-preloader-pct]');

  const TOTAL_ASSETS = SEQ.turn.count + SEQ.awaken.count;
  let loadedAssets = 0;

  function tickLoad() {
    loadedAssets++;
    const p = clamp(loadedAssets / TOTAL_ASSETS, 0, 1);
    if (loaderBar) loaderBar.style.transform = `scaleX(${p})`;
    if (loaderPct) loaderPct.textContent = Math.round(p * 100);
  }

  let loaderDone = false;
  function dismissLoader() {
    if (!loaderEl || loaderDone) return Promise.resolve();
    loaderDone = true;
    if (REDUCED || !window.gsap) { loaderEl.remove(); return Promise.resolve(); }
    return new Promise((resolve) => {
      window.gsap.timeline({
        onComplete: () => { loaderEl.remove(); resolve(); }
      })
        .to(loaderEl.querySelectorAll('.preloader__kanji, .preloader__meter, .preloader__pct, .preloader__ring'),
            { autoAlpha: 0, y: -14, duration: .5, stagger: .05, ease: 'power3.in' })
        .to(loaderEl, { yPercent: -100, duration: .9, ease: 'power4.inOut' }, '-=.15');
    });
  }

  /* safety valve — the page never stays behind the loader */
  const loaderTimeout = setTimeout(dismissLoader, 9000);

  /* ======================================================================
     3 · FALLING GLYPH RAIN
     ====================================================================== */

  function initGlyphRain() {
    const canvas = $('[data-glyphrain]');
    if (!canvas || REDUCED) { canvas && canvas.remove(); return; }

    const GLYPHS = 'ウチハマダラ写輪眼輪廻眼須佐能乎無限月読火影終焉夢闇忍術影分身天照煉獄木遁求道玉アイウエオカキクケコサシスセソタチツテトナニヌネノ〇一二三四五六七八九';
    const FS = 17;
    const ctx = canvas.getContext('2d', { alpha: true });
    let cols = [], w = 0, h = 0, raf = null, last = 0;
    const rand = (a, b) => a + Math.random() * (b - a);

    function build() {
      const f = fitCanvas(canvas);
      w = f.w; h = f.h;
      f.ctx.font = `${FS}px "Shippori Mincho B1","Hiragino Mincho ProN",serif`;
      f.ctx.textBaseline = 'top';
      const step = FS * 2.1;
      const n = Math.max(6, Math.round(w / step));
      cols = Array.from({ length: n }, (_, i) => ({
        x: (i + .5) * (w / n) + rand(-5, 5),
        y: rand(-h * .5, h),
        v: rand(26, 74),
        len: Math.round(rand(7, 18)),
        chars: Array.from({ length: 20 }, () => GLYPHS[(Math.random() * GLYPHS.length) | 0]),
        swap: rand(.12, .5),
        t: 0
      }));
    }

    function draw(dt) {
      ctx.clearRect(0, 0, w, h);
      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim() || '#e0202a';
      const gap = FS * 1.4;
      for (const c of cols) {
        c.y += c.v * dt;
        c.t += dt;
        if (c.t > c.swap) {
          c.t = 0;
          c.chars[(Math.random() * c.chars.length) | 0] = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        if (c.y - c.len * gap > h) {
          c.y = rand(-h * .6, -gap);
          c.v = rand(26, 74);
          c.len = Math.round(rand(7, 18));
        }
        for (let i = 0; i < c.len; i++) {
          const y = c.y - i * gap;
          if (y < -gap || y > h) continue;
          const fade = 1 - i / c.len;
          if (i === 0) { ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 14; }
          else { ctx.fillStyle = '#8b8792'; ctx.shadowBlur = 0; }
          ctx.globalAlpha = .3 * fade * fade;
          ctx.fillText(c.chars[i % c.chars.length], c.x, y);
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    function frame(now) {
      const dt = clamp((now - last) / 1000, 0, .05);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

    build();
    start();
    window.addEventListener('resize', build);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  }

  /* ======================================================================
     4 · HERO — cursor-tracked turn, 70 original frames
     ====================================================================== */

  function initHeroTurn() {
    const canvas = $('[data-turn-canvas]');
    const hero   = $('[data-hero]');
    if (!canvas || !hero) return;

    const track = $('[data-turn-track]');
    const label = $('[data-turn-frame]');
    const last  = SEQ.turn.count - 1;

    let ctx, w = 0, h = 0;
    let target = last / 2;                 // where the cursor says he should look
    let value  = last / 2;                 // where he actually is
    let vel    = 0;
    let drift  = 0;                        // idle sway when the pointer is away
    let idle   = true;
    let shownIndex = -1;
    let raf = null, prev = 0, inView = true;

    function resize() {
      const f = fitCanvas(canvas);
      ctx = f.ctx; w = f.w; h = f.h;
      shownIndex = -1;                     // force a repaint at the new size
    }

    function paint(index) {
      const img = frameAt('turn', index);
      if (!img) return;
      ctx.clearRect(0, 0, w, h);
      /* on wide screens he sits right of centre so the headline gets clean dark */
      const push = w > 1080 ? w * 0.11 : 0;
      drawCover(ctx, img, w, h, 1.06, push, 0);
      shownIndex = index;
    }

    /* critically damped spring — silky, and it never overshoots into jitter */
    function step(dt) {
      let goal = target;
      if (idle) {
        drift += dt * .38;
        goal = last / 2 + Math.sin(drift) * last * .21;   // he keeps scanning the dark
      }
      const k = 42, c = 2 * Math.sqrt(42);
      vel += ((goal - value) * k - vel * c) * dt;
      value += vel * dt;
      value = clamp(value, 0, last);

      const idx = Math.round(value);
      if (idx !== shownIndex) {
        paint(idx);
        if (label) label.textContent = String(idx + 1).padStart(3, '0');
        if (track) track.style.transform = `translateX(${(value / last) * 175}px)`;
      }
    }

    function frame(now) {
      const dt = clamp((now - prev) / 1000, 0, .05);
      prev = now;
      if (inView) step(dt);
      raf = requestAnimationFrame(frame);
    }

    function onPointer(e) {
      const r = hero.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1);
      target = x * last;
      idle = false;
    }

    resize();
    paint(Math.round(value));
    window.addEventListener('resize', resize);

    if (!COARSE) {
      hero.addEventListener('pointermove', onPointer, { passive: true });
      hero.addEventListener('pointerleave', () => { idle = true; });
      window.addEventListener('blur', () => { idle = true; });
    } else {
      /* touch: a drag across the stage scrubs him, and he sways otherwise */
      hero.addEventListener('touchmove', (e) => {
        if (!e.touches[0]) return;
        onPointer(e.touches[0]);
      }, { passive: true });
      hero.addEventListener('touchend', () => { idle = true; });
    }

    if (REDUCED) { paint(Math.round(last / 2)); return; }

    prev = performance.now();
    raf = requestAnimationFrame(frame);

    /* stop burning frames once the hero has scrolled away */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; },
        { threshold: 0 }).observe(hero);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
      else if (!raf) { prev = performance.now(); raf = requestAnimationFrame(frame); }
    });
  }

  /* ======================================================================
     5 · CUSTOM CURSOR · MAGNET · CLICK SPARK
     ====================================================================== */

  function initPointerFlair() {
    if (COARSE || REDUCED) { const c = $('[data-cursor]'); c && c.remove(); return; }

    const dot = $('[data-cursor]');
    let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;

    addEventListener('pointermove', (e) => {
      x = e.clientX; y = e.clientY;
      dot.classList.add('is-on');
    }, { passive: true });
    addEventListener('pointerleave', () => dot.classList.remove('is-on'));

    (function ring() {
      cx = lerp(cx, x, .18); cy = lerp(cy, y, .18);
      dot.style.transform = `translate(${cx}px, ${cy}px)`;
      requestAnimationFrame(ring);
    })();

    $$('a, button, [data-tilt]').forEach((el) => {
      el.addEventListener('pointerenter', () => dot.classList.add('is-hot'));
      el.addEventListener('pointerleave', () => dot.classList.remove('is-hot'));
    });

    /* magnetic pull on the primary controls */
    $$('[data-magnet]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * .28;
        const dy = (e.clientY - (r.top + r.height / 2)) * .32;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });

    /* click spark */
    $$('[data-spark]').forEach((el) => {
      el.addEventListener('click', (e) => {
        for (let i = 0; i < 12; i++) {
          const s = document.createElement('i');
          s.className = 'spark';
          s.style.left = e.clientX + 'px';
          s.style.top = e.clientY + 'px';
          document.body.appendChild(s);
          const a = (Math.PI * 2 * i) / 12 + Math.random() * .5;
          const d = 40 + Math.random() * 60;
          s.animate(
            [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
             { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0)`, opacity: 0 }],
            { duration: 520 + Math.random() * 280, easing: 'cubic-bezier(.2,.7,.3,1)' }
          ).onfinish = () => s.remove();
        }
      });
    });

    /* card tilt */
    $$('[data-tilt]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5;
        const py = (e.clientY - r.top) / r.height - .5;
        el.style.transform = `perspective(900px) rotateX(${-py * 5}deg) rotateY(${px * 6}deg) translateZ(0)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ======================================================================
     6 · LIGHTNING — shared by the full-screen thunder and the forms tear
     ====================================================================== */

  /* ---- midpoint-displacement lightning ---- */
  function buildBolt(x1, y1, x2, y2, disp, detail) {
    let pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    for (let d = 0; d < detail; d++) {
      const np = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const nx = -(b.y - a.y), ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1;
        const off = (Math.random() - 0.5) * disp;
        np.push(a, { x: mx + nx / len * off, y: my + ny / len * off });
      }
      np.push(pts[pts.length - 1]); pts = np; disp *= 0.55;
    }
    return pts;
  }

  const BOLT_COLOUR = {
    crimson: '255,104,92',
    volt:  '159,232,255',
    white: '240,245,255',
    rinne: '196,158,255'
  };

  function strokePath(ctx, pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawBolt(ctx, b) {
    const col = BOLT_COLOUR[b.col] || BOLT_COLOUR.white;
    const pass = () => { strokePath(ctx, b.segs); b.branches.forEach((p) => strokePath(ctx, p)); };
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(' + col + ',' + (0.9 * b.life) + ')';
    ctx.shadowBlur = 26;
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.30 * b.life) + ')';
    ctx.lineWidth = 17;
    pass();
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.55 * b.life) + ')';
    ctx.lineWidth = 7;
    pass();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.98 * b.life) + ')';
    ctx.lineWidth = 3;
    pass();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- full-screen thunder: one strike across the viewport every 2s ---- */

  const THUNDER_INTERVAL = 2000;
  /* the strike takes the colour of whichever act currently owns the accent */
  const ACCENT_BOLT = { '#e0202a': 'crimson', '#5aa8ff': 'volt', '#9fb4d8': 'white', '#8b5cf6': 'rinne' };

  function initThunder() {
    const canvas = $('[data-thunder]');
    const flash  = $('[data-thunder-flash]');
    if (!canvas) return;
    if (REDUCED) { canvas.remove(); flash && flash.remove(); return; }

    let ctx = null, w = 0, h = 0, bolts = [], raf = null;

    function resize() {
      const f = fitCanvas(canvas, 1920);
      ctx = f.ctx; w = f.w; h = f.h;
    }

    function strike() {
      if (document.hidden) return;
      const col = ACCENT_BOLT[accentNow] || 'crimson';
      const x = w * (0.1 + Math.random() * 0.8);
      const segs = buildBolt(x, -10, x + (Math.random() - 0.5) * w * 0.3, h + 10,
                             Math.min(w, h) * 0.2, 7);
      const branches = [];
      const nb = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < nb; i++) {
        const p = segs[Math.floor(segs.length * (0.15 + Math.random() * 0.6))];
        if (p) branches.push(buildBolt(p.x, p.y, p.x + (Math.random() - 0.5) * w * 0.4,
                                       p.y + h * (0.12 + Math.random() * 0.28), 46, 5));
      }
      bolts.push({ segs, branches, life: 1, col });

      /* a double flicker, the way real lightning re-strikes its own channel */
      if (flash && flash.animate) {
        flash.animate(
          [{ opacity: 0 }, { opacity: .34, offset: .06 }, { opacity: .06, offset: .2 },
           { opacity: .22, offset: .3 }, { opacity: 0 }],
          { duration: 620, easing: 'ease-out' });
      }
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        /* fade before drawing, so the last frame leaves a clean canvas behind */
        b.life -= 0.06;
        if (b.life <= 0) { bolts.splice(i, 1); continue; }
        drawBolt(ctx, b);
      }
      /* nothing left to draw: the loop sleeps until the next strike */
      raf = bolts.length ? requestAnimationFrame(frame) : null;
    }

    resize();
    addEventListener('resize', resize);
    strike();
    setInterval(strike, THUNDER_INTERVAL);
  }

  /* ======================================================================
     7 · GSAP SCENES
     ====================================================================== */

  function splitWords(el) {
    if (el.dataset.splitReady === 'true') return;
    const text = el.textContent || '';
    el.setAttribute('aria-label', text.trim());
    el.textContent = '';
    text.split(/(\s+)/).forEach((part) => {
      if (!part.trim()) { el.appendChild(document.createTextNode(part)); return; }
      const mask = document.createElement('span');
      const word = document.createElement('span');
      mask.className = 'split-word-mask';
      mask.setAttribute('aria-hidden', 'true');
      word.className = 'split-word';
      word.textContent = part;
      mask.appendChild(word);
      el.appendChild(mask);
    });
    el.dataset.splitReady = 'true';
  }

  /* One writer for --accent. Pinned scenes call this from their own onUpdate,
     so whichever scene is actually on screen always wins — no trigger races. */
  let accentNow = '';
  function applyAccent(hex, soft) {
    if (hex === accentNow) return;
    accentNow = hex;
    const root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-soft', soft || hex.replace(/^#/, 'rgba(') );
  }
  const SOFT = {
    '#e0202a': 'rgba(224,32,42,.16)',
    '#5aa8ff': 'rgba(90,168,255,.16)',
    '#9fb4d8': 'rgba(159,180,216,.16)',
    '#8b5cf6': 'rgba(139,92,246,.16)'
  };
  const setAccent = (hex) => applyAccent(hex, SOFT[hex]);

  /* If the CDN never arrives, everything that motion would have revealed
     has to be visible on its own. */
  function degradeToStatic() {
    $$('[data-split-reveal], [data-reveal-item]').forEach((el) => {
      el.style.opacity = '1'; el.style.transform = 'none'; el.style.filter = 'none';
    });
    $$('[data-awaken-cap]').forEach((c) => { c.style.opacity = '1'; c.style.position = 'relative'; });
    const caps = $('.awaken__caps');
    if (caps) { caps.style.display = 'grid'; caps.style.gap = '28px'; }
    $$('[data-count]').forEach((el) => { el.textContent = Number(el.dataset.count || 0).toLocaleString(); });
    $$('.plate').forEach((p, i) => { p.style.opacity = i === 0 ? '1' : '0'; });
  }

  function initScenes() {
    const gsap = window.gsap;
    const ST = window.ScrollTrigger;
    if (!gsap || !ST) { degradeToStatic(); return; }
    gsap.registerPlugin(ST);

    /* ---- Lenis: the one and only smooth-scroll engine ---- */
    let lenis = null;
    if (!REDUCED && window.Lenis) {
      lenis = new window.Lenis({ lerp: .085, smoothWheel: true, wheelMultiplier: .95 });
      lenis.on('scroll', ST.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
      /* keep in-page anchors on the smooth track */
      $$('a[href^="#"]').forEach((a) => {
        a.addEventListener('click', (e) => {
          const t = $(a.getAttribute('href'));
          if (!t) return;
          e.preventDefault();
          lenis.scrollTo(t, { offset: -10 });
        });
      });
    }

    /* ---- pinned scenes FIRST ----
       Their pins push everything below them down. ScrollTrigger refreshes in
       creation order, so if a pin is built after the triggers it displaces,
       those triggers measure against a page that has not been pushed yet. */
    if (!REDUCED) {
      initAwakenScene(gsap, ST);
      initFormsScene(gsap, ST);
    }

    /* ---- split reveals ---- */
    if (REDUCED) {
      gsap.set('[data-split-reveal], [data-reveal-item]', { autoAlpha: 1, clearProps: 'all' });
    } else {
      $$('[data-split-reveal]').forEach((el) => {
        splitWords(el);
        /* hero text is choreographed by the entrance, not by scroll */
        if (el.closest('.hero')) {
          gsap.set(el.querySelectorAll('.split-word'),
            { yPercent: 112, autoAlpha: 0, filter: 'blur(8px)' });
          return;
        }
        gsap.fromTo(el.querySelectorAll('.split-word'),
          { yPercent: 112, autoAlpha: 0, filter: 'blur(8px)' },
          {
            yPercent: 0, autoAlpha: 1, filter: 'blur(0px)',
            duration: .95, ease: 'power4.out', stagger: .045,
            scrollTrigger: { trigger: el, start: 'top 86%', once: true }
          });
      });

      $$('[data-story-section]').forEach((section) => {
        const items = section.querySelectorAll('[data-reveal-item]');
        if (!items.length) return;
        gsap.fromTo(items,
          { y: 34, autoAlpha: 0, filter: 'blur(7px)' },
          {
            y: 0, autoAlpha: 1, filter: 'blur(0px)',
            duration: 1, ease: 'power4.out', stagger: .08,
            scrollTrigger: { trigger: section, start: 'top 82%', once: true }
          });
      });

      /* the hero holds its entrance until the loader has actually lifted */
      gsap.set('.hero__copy [data-reveal-item], .hero__hint, .hero__scroll', { autoAlpha: 0 });
    }

    /* ---- marquee ---- */
    const row = $('[data-marquee]');
    if (row && !REDUCED) {
      row.innerHTML += row.innerHTML;
      gsap.to(row, { xPercent: -50, duration: 26, ease: 'none', repeat: -1 });
    }

    /* ---- count up ---- */
    $$('[data-count]').forEach((el) => {
      const to = Number(el.dataset.count) || 0;
      if (REDUCED) { el.textContent = to.toLocaleString(); return; }
      const o = { v: 0 };
      gsap.to(o, {
        v: to, duration: 1.6, ease: 'power2.out',
        onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString(); },
        scrollTrigger: { trigger: el, start: 'top 88%', once: true }
      });
    });

    /* ---- accent per act; the two pinned scenes set their own in onUpdate ---- */
    [['#hero', '#e0202a'], ['#arsenal', '#e0202a']].forEach(([sel, hex]) => {
      const el = $(sel);
      if (!el) return;
      ST.create({
        trigger: el, start: 'top 55%', end: 'bottom 45%',
        onEnter: () => setAccent(hex), onEnterBack: () => setAccent(hex)
      });
    });

    /* Pinning inserts spacers, which moves every trigger below it. Sort into
       document order first, then refresh — boot runs after images decode, so a
       plain `load` listener would already have missed the event. */
    const settle = () => { ST.sort(); ST.refresh(); };
    requestAnimationFrame(settle);
    if (document.readyState === 'complete') setTimeout(settle, 0);
    else addEventListener('load', settle);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
    addEventListener('resize', () => ST.refresh());
  }

  /* ---- 02 · AWAKENING: 38 frames scrubbed by scroll ---- */

  function initAwakenScene(gsap, ST) {
    const section = $('[data-awaken]');
    const stick   = $('[data-awaken-stick]');
    const canvas  = $('[data-awaken-canvas]');
    if (!section || !canvas) return;

    const caps  = $$('[data-awaken-cap]');
    const bar   = $('[data-awaken-bar]');
    const pct   = $('[data-awaken-pct]');
    const flash = $('[data-awaken-flash]');
    const last  = SEQ.awaken.count - 1;

    let ctx, w = 0, h = 0, shown = -1;
    const state = { p: 0 };

    function resize() {
      const f = fitCanvas(canvas);
      ctx = f.ctx; w = f.w; h = f.h; shown = -1;
      render();
    }

    function render() {
      if (!ctx) return;
      const idx = Math.round(state.p * last);
      if (idx === shown) return;
      const img = frameAt('awaken', idx);
      if (!img) return;
      ctx.clearRect(0, 0, w, h);
      drawCover(ctx, img, w, h, 1.06 - state.p * .04);   // a slow settle inward
      shown = idx;
    }

    resize();
    addEventListener('resize', resize);

    /* One trigger owns the whole scene. Everything else reads its progress —
       separate triggers on a pinned section drift once the pin spacer lands. */
    const N = caps.length || 1;

    function paintCaptions(p) {
      caps.forEach((cap, i) => {
        const start = i / N;
        const local = (p - start) * N;              // 0..1 inside this beat
        let a = 0, y = 26;
        if (local >= 0 && local <= 1) {
          const inT  = clamp(local / .26, 0, 1);     // rises over the first quarter
          const outT = i === N - 1 ? 1 : 1 - clamp((local - .78) / .22, 0, 1);
          a = inT * outT;
          y = lerp(26, 0, inT) - (1 - outT) * 20;
        }
        cap.style.opacity = String(a);
        cap.style.transform = `translateY(${y}px)`;
        cap.style.filter = `blur(${(1 - a) * 8}px)`;
      });
    }

    function paintFlash(p) {
      if (!flash) return;
      /* a chakra burst right as the eyes open, then gone */
      const t = clamp((p - .84) / .1, 0, 1) * (1 - clamp((p - .94) / .06, 0, 1));
      flash.style.opacity = String(t * .5);
    }

    gsap.timeline({
      scrollTrigger: {
        trigger: section, start: 'top top', end: '+=320%',
        scrub: .7, pin: stick, anticipatePin: 1, invalidateOnRefresh: true,
        onLeaveBack:  () => setAccent('#e0202a'),
        onUpdate: (self) => {
          const p = self.progress;
          state.p = p;
          /* a scrubbed timeline keeps updating for a beat after the next section
             has claimed the accent — isActive is the authority on who owns it */
          if (self.isActive) setAccent('#5aa8ff');
          render();
          paintCaptions(p);
          paintFlash(p);
          if (bar) bar.style.transform = `scaleX(${p})`;
          if (pct) pct.textContent = Math.round(p * 100) + '%';
        }
      }
    });

    paintCaptions(0);
  }

  /* ---- 03 · THREE FORMS ------------------------------------------------
     The transition is the Naruto reference effect: a jagged crack-clip that
     tears the current form away from left to right while lightning strikes
     ride the tear line, with a white break and a shake on contact.
     Each of the three forms still runs its own 3-stage ladder underneath,
     so what the tear reveals is itself still forming.
     -------------------------------------------------------------------- */

  function initFormsScene(gsap, ST) {
    const section = $('[data-forms]');
    const stick   = $('[data-forms-stick]');
    if (!section || !stick) return;

    const platesWrap = $('[data-forms-plates]');
    const plates = $$('[data-plate]');
    const fxCanvas = $('[data-forms-fx]');
    const flash  = $('[data-forms-flash]');
    const idxEl  = $('[data-forms-idx]');
    const jpEl   = $('[data-forms-jp]');
    const nameEl = $('[data-forms-name]');
    const descEl = $('[data-forms-desc]');
    const specEl = $('[data-forms-spec]');
    const stateEl = $('[data-forms-state]');
    const dots   = $$('[data-forms-stage]');
    const stageLabel = $('[data-forms-stagelabel]');
    const rails  = $$('[data-forms-rail]');

    const STAGES = ['FORMING', 'SURGING', 'MANIFEST'];
    const DATA = [
      {
        jp: '穢土転生', name: 'Edo Tensei Madara', accent: '#e0202a', state: 'EDO_TENSEI',
        desc: 'Dragged out of the pure land in a body that cannot tire, cannot bleed out, and cannot be talked down. The Eternal Mangekyo is already spinning before his feet touch soil.',
        spec: [['眼', 'Eternal Mangekyo Sharingan'], ['術', 'Perfect Susanoo'], ['状態', 'Immortal reanimation']]
      },
      {
        jp: '十尾人柱力', name: 'Ten-Tails Jinchuriki', accent: '#9fb4d8', state: 'JUUBI_JINCHURIKI',
        desc: 'He takes the beast whole. Hair goes white, horns break the skin, and nine black orbs settle into orbit behind a man who no longer needs to dodge anything.',
        spec: [['眼', 'Rinnegan, both eyes'], ['術', 'Truth-Seeking Orbs'], ['状態', 'Ten-Tails jinchuriki']]
      },
      {
        jp: '輪廻写輪眼', name: 'Three-Eyed Madara', accent: '#8b5cf6', state: 'RINNE_SHARINGAN',
        desc: 'The third eye opens on his forehead and the moon answers it. From here the Infinite Tsukuyomi is not a plan any more — it is a countdown with no one left to stop it.',
        spec: [['眼', 'Rinne Sharingan'], ['術', 'Infinite Tsukuyomi'], ['状態', 'Ascended, unopposed']]
      }
    ];

    /* Two tear windows inside the pinned scroll, sized so each one reads over
       roughly five seconds at an ordinary scrolling pace. */
    const W1S = 0.16, W1E = 0.46;   // form 1 torn away -> form 2, volt-blue strike
    const W2S = 0.60, W2E = 0.90;   // form 2 torn away -> form 3, the big one
    /* each form's own 3-stage ladder, as a window on the same progress */
    const LADDER = [[0.00, 0.15], [0.17, 0.52], [0.61, 0.95]];

    /* form 1 sits on top and is torn off first */
    plates.forEach((p, i) => { p.style.opacity = '1'; p.style.zIndex = String(plates.length - i); });

    /* ---- the jagged tear, straight from the reference ---- */
    const N = 22;
    const offs1 = Array.from({ length: N + 1 }, () => (Math.random() - 0.5) * 7);
    const offs2 = Array.from({ length: N + 1 }, () => (Math.random() - 0.5) * 11);
    function crackClip(cut, jit, time, offsets) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const y = (i / N) * 100;
        const x = cut + offsets[i] + Math.sin(time * 3 + i * 0.9) * jit;
        pts.push(x.toFixed(2) + '% ' + y.toFixed(2) + '%');
      }
      return 'polygon(' + pts.join(',') + ',100% 100%,100% 0%)';
    }

    let ctx = null, fw = 0, fh = 0;
    let bolts = [], motes = [], shake = 0, raf = null, near = false;
    let progress = 0, lastStrike = 0, lastCrackle = 0;

    function buildMotes() {
      motes = [];
      const n = Math.floor(fw / 26);
      for (let i = 0; i < n; i++) {
        motes.push({
          x: Math.random() * fw, y: Math.random() * fh,
          r: .6 + Math.random() * 1.6, a: .08 + Math.random() * .2,
          tw: Math.random() * Math.PI * 2
        });
      }
    }

    function resizeFx() {
      const f = fitCanvas(fxCanvas);
      ctx = f.ctx; fw = f.w; fh = f.h;
      buildMotes();
    }

    function spawnBolt(x, big, col) {
      const segs = buildBolt(x, -10, x + (Math.random() - 0.5) * (big ? 60 : 120),
                             fh * (big ? 0.95 : 0.55), big ? 72 : 40, big ? 7 : 6);
      const branches = [];
      const nb = big ? 3 : 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < nb; i++) {
        const p = segs[Math.floor(segs.length * (0.25 + Math.random() * 0.5))];
        if (p) branches.push(buildBolt(p.x, p.y, p.x + (Math.random() - 0.5) * 180,
                                       p.y + fh * 0.2 * Math.random(), big ? 36 : 20, 5));
      }
      bolts.push({ segs, branches, life: 1, col });
    }

    /* ---- copy + stage readout ---- */
    let shownForm = -1, shownStage = -1;

    function applyCopy(form, stage, owned) {
      if (owned) setAccent(DATA[form].accent);
      if (form !== shownForm) {
        const d = DATA[form];
        idxEl.textContent = String(form + 1).padStart(2, '0');
        jpEl.textContent = d.jp;
        nameEl.textContent = d.name;
        descEl.textContent = d.desc;
        specEl.innerHTML = d.spec.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
        rails.forEach((r, i) => r.classList.toggle('is-on', i === form));
        gsap.fromTo([jpEl, nameEl, descEl, specEl],
          { autoAlpha: 0, y: 18 },
          { autoAlpha: 1, y: 0, duration: .55, ease: 'power3.out', stagger: .05, overwrite: true });
        shownForm = form;
      }
      if (stage !== shownStage) {
        dots.forEach((d, i) => d.classList.toggle('is-on', i <= stage));
        stageLabel.textContent = STAGES[stage];
        shownStage = stage;
      }
    }

    /* each form crossfades its own three stage plates as it is revealed */
    function applyLadders(p) {
      plates.forEach((plate, f) => {
        const [a, b] = LADDER[f];
        const sp = clamp((p - a) / (b - a), 0, 1);
        const g = sp * 2;                                  // three stages, two steps
        const imgs = plate.querySelectorAll('.plate__img');
        imgs.forEach((img, i) => {
          img.style.opacity = i === 0 ? '1' : String(clamp(g - i + 1, 0, 1));
        });
      });
    }

    /* the panel flips the moment the tear passes the middle of the screen, so
       the words always match whichever form is holding most of the frame */
    const MID1 = W1S + (W1E - W1S) * 0.5;
    const MID2 = W2S + (W2E - W2S) * 0.5;
    function activeForm(p) {
      if (p < MID1) return 0;
      if (p < MID2) return 1;
      return 2;
    }
    function activeStage(p, form) {
      const [a, b] = LADDER[form];
      const sp = clamp((p - a) / (b - a), 0, 1);
      return Math.min(2, Math.floor(sp * 2.999));
    }

    resizeFx();
    addEventListener('resize', resizeFx);

    /* ---- the render loop: tear geometry, motes, bolts, shake ---- */
    const t0 = performance.now();
    function frame() {
      const time = (performance.now() - t0) * 0.001;
      ctx.clearRect(0, 0, fw, fh);

      const t1 = clamp((progress - W1S) / (W1E - W1S), 0, 1);
      const t2 = clamp((progress - W2S) / (W2E - W2S), 0, 1);
      plates[0].style.clipPath = crackClip(t1 * 118 - 9, (t1 > 0 && t1 < 1) ? 1.5 : 0, time, offs1);
      plates[1].style.clipPath = crackClip(t2 * 118 - 9, (t2 > 0 && t2 < 1) ? 2.4 : 0, time, offs2);

      /* chakra motes, tinted by whichever form currently holds the frame */
      ctx.globalCompositeOperation = 'lighter';
      for (const m of motes) {
        m.tw += 0.05;
        const twk = 0.5 + 0.5 * Math.sin(m.tw);
        const col = t2 > 0.5 ? '196,158,255' : (t1 > 0.5 ? '200,214,240' : '255,120,110');
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + col + ',' + (m.a * twk * 0.6) + ')';
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        drawBolt(ctx, b);
        b.life -= 0.085;
        if (b.life <= 0) bolts.splice(i, 1);
      }

      /* shake the plates, never the pinned wrapper — GSAP owns that transform */
      if (shake > 0.01) {
        platesWrap.style.transform =
          `translate(${(Math.random() - .5) * shake * 9}px, ${(Math.random() - .5) * shake * 9}px)`;
        shake *= 0.85;
      } else if (platesWrap.style.transform) {
        platesWrap.style.transform = '';
      }

      raf = near ? requestAnimationFrame(frame) : null;
    }

    function runFx(on) {
      near = on;
      if (on && !raf && !document.hidden) { raf = requestAnimationFrame(frame); }
      if (!on && raf) { cancelAnimationFrame(raf); raf = null; }
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => runFx(en.isIntersecting),
        { rootMargin: '30% 0px 30% 0px' }).observe(section);
    } else runFx(true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
      else if (near && !raf) raf = requestAnimationFrame(frame);
    });

    applyLadders(0);
    applyCopy(0, 0, false);

    gsap.timeline({
      scrollTrigger: {
        trigger: section, start: 'top top', end: '+=560%',
        scrub: .8, pin: stick, anticipatePin: 1, invalidateOnRefresh: true,
        onEnter:     () => { shownForm = -1; },
        onEnterBack: () => { shownForm = -1; },
        onLeave:     () => setAccent('#e0202a'),
        onLeaveBack: () => setAccent('#5aa8ff'),
        onUpdate: (self) => {
          const p = self.progress;
          progress = p;
          applyLadders(p);

          const form = activeForm(p);
          applyCopy(form, activeStage(p, form), self.isActive);

          const t1 = clamp((p - W1S) / (W1E - W1S), 0, 1);
          const t2 = clamp((p - W2S) / (W2E - W2S), 0, 1);
          if (stateEl) {
            stateEl.textContent =
              t1 > 0 && t1 < 1 ? 'TEARING…'
              : t2 > 0 && t2 < 1 ? 'TEARING…'
              : DATA[form].state;
          }

          const now = performance.now();
          /* first tear: volt-blue crackle riding the crack, soft break */
          if (t1 > 0.02 && t1 < 0.98 && now - lastCrackle > 90) {
            const cut = t1 * 118 - 9;
            const big = Math.random() < 0.4;
            spawnBolt(fw * (cut / 100) + (Math.random() - 0.5) * 40, big, 'volt');
            lastCrackle = now;
            if (flash) {
              gsap.fromTo(flash, { opacity: big ? .38 : .2 },
                { opacity: 0, duration: .45, ease: 'power2.out', overwrite: true });
            }
            shake = Math.max(shake, big ? .7 : .4);
          }
          /* second tear: the full strike — flash and shake every time */
          if (t2 > 0.02 && t2 < 0.98 && now - lastStrike > 150) {
            const cut = t2 * 118 - 9;
            spawnBolt(fw * (cut / 100) + (Math.random() - 0.5) * 30, true,
                      Math.random() < 0.5 ? 'rinne' : 'white');
            lastStrike = now;
            shake = 1;
            if (flash) {
              gsap.fromTo(flash, { opacity: .5 },
                { opacity: 0, duration: .5, ease: 'power2.out', overwrite: true });
            }
          }
        }
      }
    });
  }

  /* ---- the composed hero entrance, fired once the loader is gone ---- */

  function heroEntrance() {
    const gsap = window.gsap;
    if (!gsap || REDUCED) {
      $$('.hero__copy [data-reveal-item], .hero__hint, .hero__scroll')
        .forEach((el) => { el.style.opacity = '1'; el.style.visibility = 'visible'; });
      $$('.hero .split-word').forEach((el) => {
        el.style.opacity = '1'; el.style.visibility = 'visible';
        el.style.transform = 'none'; el.style.filter = 'none';
      });
      return;
    }
    gsap.timeline({ defaults: { ease: 'power4.out' } })
      .to('.hero__jp .split-word',
          { yPercent: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 1.05, stagger: .05 })
      .to('.hero__en .split-word',
          { yPercent: 0, autoAlpha: 1, filter: 'blur(0px)', duration: .85, stagger: .04 }, '-=.7')
      .fromTo('.hero__copy [data-reveal-item]',
          { y: 24 }, { autoAlpha: 1, y: 0, duration: .9, stagger: .1 }, '-=.6')
      .to('.hero__hint, .hero__scroll', { autoAlpha: 1, duration: .8 }, '-=.4');
  }

  /* ======================================================================
     8 · BOOT
     ====================================================================== */

  function boot() {
    initGlyphRain();
    initPointerFlair();

    /* the hero needs its frames before it can paint, so it waits on the load */
    Promise.all([
      loadSequence('turn', tickLoad),
      loadSequence('awaken', tickLoad)
    ]).then(() => {
      clearTimeout(loaderTimeout);
      initHeroTurn();
      initScenes();
      return dismissLoader();
    }).then(() => { heroEntrance(); initThunder(); }).catch(() => {
      clearTimeout(loaderTimeout);
      initScenes();
      dismissLoader().then(() => { heroEntrance(); initThunder(); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
