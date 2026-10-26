// ─── LOADER (runs immediately after the loader markup, independent of the
// heavy main script / Lenis, so it always shows on refresh) ───
// ─── MAGNETIC TEXT PARTICLES + NUMBER COUNTER SEQUENCE ─────────────────
// Renders "WELCOME TO" then morphs the same particle swarm into
// "MY PORTFOLIO", then dissolves into a fast 1 → 100 counter before
// the loader closes. Particles are sampled from off-screen text
// renders (same pixel-sampling idea as the hero portrait effect) and
// respond to the cursor with a magnetic push, so the copy itself
// feels alive rather than a static logo.
(function () {
    const canvas = document.getElementById('loader-text-canvas');
    const ctx = canvas.getContext('2d');
    const counterWrap = document.querySelector('.loader-counter-wrap');
    const counterEl = document.getElementById('loaderCounter');
    const statusEl = document.getElementById('loaderStatus');
    const barWrap = document.querySelector('.loader-bar-wrap');
    const bar = document.getElementById('loaderBar');
    const loader = document.getElementById('loader');

    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles = [];
    let mouse = { x: -9999, y: -9999 };
    let rafId = null;
    let currentText = '';

    function sizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        W = rect.width; H = rect.height;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Shrinks the font until the text fits within the canvas width.
    function fitFontSize(text, maxWidth, maxSize) {
        let size = maxSize;
        ctx.textBaseline = 'middle';
        while (size > 14) {
            ctx.font = `700 ${size}px 'Space Grotesk', sans-serif`;
            if (ctx.measureText(text).width <= maxWidth) break;
            size -= 2;
        }
        return size;
    }

    // Samples an off-screen render of `text` into a target particle
    // grid, then re-targets the existing swarm toward those points
    // (spring physics does the morphing) instead of hard-cutting.
    function morphTo(text) {
        currentText = text;
        const gap = window.innerWidth < 620 ? 3 : 4;
        const size = fitFontSize(text, W * 0.94, W < 360 ? 46 : (W < 480 ? 56 : (W < 768 ? 72 : 92)));
        ctx.font = `700 ${size}px 'Space Grotesk', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const off = document.createElement('canvas');
        off.width = Math.ceil(W); off.height = Math.ceil(H);
        const octx = off.getContext('2d');
        octx.font = ctx.font;
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillStyle = '#fff';
        octx.fillText(text, off.width / 2, off.height / 2);

        let data;
        try { data = octx.getImageData(0, 0, off.width, off.height).data; }
        catch (e) { data = null; }

        const targets = [];
        if (data) {
            for (let y = 0; y < off.height; y += gap) {
                for (let x = 0; x < off.width; x += gap) {
                    const i = (y * off.width + x) * 4;
                    if (data[i + 3] > 90) targets.push({ x, y });
                }
            }
        }

        // Reuse as many existing particles as possible so they glide
        // to the new letterforms; spawn/retire the remainder.
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            const grad = t.x / off.width;
            const color = grad < 0.5 ? 0 : (grad < 0.8 ? 1 : 2);   // index into COLORS
            if (particles[i]) {
                particles[i].tx = t.x; particles[i].ty = t.y;
                particles[i].dying = false;
                particles[i].opacityMul = 1;
                particles[i].ci = color;
            } else {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.max(W, H) * 0.6;
                particles.push({
                    x: W / 2 + Math.cos(angle) * r,
                    y: H / 2 + Math.sin(angle) * r,
                    tx: t.x, ty: t.y, vx: 0, vy: 0,
                    size: 1.3 + Math.random() * 1.1,
                    ci: color, dying: false, opacityMul: 1,
                });
            }
        }
        for (let i = targets.length; i < particles.length; i++) {
            particles[i].dying = true;
        }
    }

    // Sends every particle flying outward and fading — used for the
    // final dissolve into the number counter.
    function dissolve() {
        for (const p of particles) {
            const angle = Math.atan2(p.y - H / 2, p.x - W / 2) || Math.random() * Math.PI * 2;
            p.tx = p.x + Math.cos(angle) * 260;
            p.ty = p.y + Math.sin(angle) * 260;
            p.dying = true;
        }
    }

    canvas.addEventListener('mousemove', e => {
        const r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

    // PERFORMANCE: the old loop set shadowBlur and issued one beginPath/fill
    // per particle (thousands per frame) — that was the main source of the
    // lag. Now particles are bucketed by colour + quantised alpha and each
    // bucket is drawn with ONE path/fill, with a cheap soft halo pass
    // replacing the per-particle blur. Same look, a fraction of the cost.
    const COLORS = ['#ff4d88', '#a855f7', '#ffffff'];
    const ALPHA_STEPS = 11;
    const batches = Array.from({ length: COLORS.length * ALPHA_STEPS }, () => []);
    const TAU = Math.PI * 2;
    let lastT = 0;

    function step(now) {
        rafId = requestAnimationFrame(step);
        // normalise motion to real elapsed time so a slow frame never
        // makes the swarm lurch (1 = a 60fps frame)
        const dt = lastT ? Math.min((now - lastT) / 16.667, 2.5) : 1;
        lastT = now;
        const damp = Math.pow(0.84, dt);

        ctx.clearRect(0, 0, W, H);
        for (let b = 0; b < batches.length; b++) batches[b].length = 0;

        const mx = mouse.x, my = mouse.y;
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            const dx = mx - p.x, dy = my - p.y;
            const d2 = dx * dx + dy * dy;
            if (!p.dying && d2 < 4900 && d2 > 0.0001) {
                const dist = Math.sqrt(d2);
                const force = (70 - dist) / 70;
                p.vx -= (dx / dist) * force * 3.4 * dt;
                p.vy -= (dy / dist) * force * 3.4 * dt;
            } else {
                const k = (p.dying ? 0.1 : 0.04) * dt;
                p.vx += (p.tx - p.x) * k;
                p.vy += (p.ty - p.y) * k;
            }
            p.vx *= damp; p.vy *= damp;
            p.x += p.vx * dt; p.y += p.vy * dt;

            let a = ALPHA_STEPS - 1;
            if (p.dying) {
                p.opacityMul -= 0.045 * dt;
                if (p.opacityMul <= 0) {
                    // swap-remove: O(1) instead of an O(n) splice per particle
                    particles[i] = particles[particles.length - 1];
                    particles.pop();
                    continue;
                }
                a = Math.round(p.opacityMul * (ALPHA_STEPS - 1));
            }
            batches[p.ci * ALPHA_STEPS + a].push(p);
        }

        for (let c = 0; c < COLORS.length; c++) {
            ctx.fillStyle = COLORS[c];
            for (let a = 1; a < ALPHA_STEPS; a++) {
                const arr = batches[c * ALPHA_STEPS + a];
                if (!arr.length) continue;
                const alpha = a / (ALPHA_STEPS - 1);
                // soft halo (replaces shadowBlur)
                ctx.globalAlpha = alpha * 0.16;
                ctx.beginPath();
                for (let j = 0; j < arr.length; j++) {
                    const p = arr[j], r = p.size * 2.5;
                    ctx.moveTo(p.x + r, p.y);
                    ctx.arc(p.x, p.y, r, 0, TAU);
                }
                ctx.fill();
                // crisp core
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                for (let j = 0; j < arr.length; j++) {
                    const p = arr[j];
                    ctx.moveTo(p.x + p.size, p.y);
                    ctx.arc(p.x, p.y, p.size, 0, TAU);
                }
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    // Fast 1 → 100 counter with an easing curve so it starts brisk
    // and races to the finish, syncing the thin progress bar to match.
    function runCounter(duration) {
        return new Promise(resolve => {
            let start = 0, shown = -1;
            function frame(now) {
                if (!start) start = now;
                const t = Math.min((now - start) / duration, 1);
                const eased = 1 - Math.pow(1 - t, 3);
                const value = Math.min(100, Math.round(eased * 100));
                // the bar is a compositor-only transform (no layout per frame);
                // the number is only written when it actually changes
                bar.style.transform = `scaleX(${eased.toFixed(4)})`;
                if (value !== shown) { shown = value; counterEl.textContent = value; }
                if (t < 1) requestAnimationFrame(frame);
                else { counterEl.textContent = 100; bar.style.transform = 'scaleX(1)'; resolve(); }
            }
            requestAnimationFrame(frame);
        });
    }

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Resolves once the tab is visible (timers/rAF are throttled in
    // background tabs, which used to make the steps race past).
    function whenVisible() {
        return new Promise(resolve => {
            if (!document.hidden) return resolve();
            const on = () => {
                if (!document.hidden) {
                    document.removeEventListener('visibilitychange', on);
                    resolve();
                }
            };
            document.addEventListener('visibilitychange', on);
        });
    }

    // Wait until the web fonts used by the canvas text are really
    // available (otherwise the particles are sampled from a fallback
    // font, or nothing at all), but never block more than ~1.5s.
    function fontsReady() {
        if (!document.fonts || !document.fonts.load) return Promise.resolve();
        const loads = Promise.all([
            document.fonts.load("700 48px 'Space Grotesk'", 'WELCOME TO MY PORTFOLIO'),
            document.fonts.load("48px 'Bebas Neue'", '0123456789'),
        ]).catch(() => { });
        return Promise.race([loads, wait(1500)]);
    }

    // Wait until the canvas actually has a size (layout can lag behind
    // script execution on a refresh), up to ~1s.
    async function layoutReady() {
        for (let i = 0; i < 60; i++) {
            const r = canvas.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return;
            await new Promise(res => requestAnimationFrame(res));
        }
    }

    // Cross-fades the status label instead of hard-swapping it, and
    // callers hold each message for a minimum time so it is readable.
    async function setStatus(text) {
        statusEl.classList.remove('is-visible');
        await wait(250);
        statusEl.textContent = text;
        statusEl.classList.add('is-visible');
    }

    let pageLoaded = document.readyState === 'complete';
    if (!pageLoaded) window.addEventListener('load', () => { pageLoaded = true; }, { once: true });
    function waitForPageLoad(maxMs) {
        const start = performance.now();
        return new Promise(resolve => {
            (function check() {
                if (pageLoaded || performance.now() - start > maxMs) resolve();
                else setTimeout(check, 50);
            })();
        });
    }

    let finished = false;
    function closeLoader() {
        if (finished) return;
        finished = true;
        if (rafId) cancelAnimationFrame(rafId);
        loader.classList.add('hide');
        setTimeout(() => { loader.style.display = 'none'; }, 700);
    }

    async function sequence() {
        // "Welcome" is visible immediately, so the loader never looks empty.
        statusEl.textContent = 'Welcome';
        statusEl.classList.add('is-visible');

        await Promise.all([fontsReady(), layoutReady()]);
        await whenVisible();

        sizeCanvas();
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { sizeCanvas(); if (currentText && !finished) morphTo(currentText); }, 120);
        });
        requestAnimationFrame(step);
        canvas.classList.add('is-visible');

        morphTo('WELCOME TO');
        await wait(2200);
        await setStatus('Crafting the experience');

        morphTo('MY PORTFOLIO');
        await wait(2300);

        // Both lines of copy clear out together in one dissolve, then
        // the counter takes over.
        dissolve();
        canvas.classList.remove('is-visible');
        await wait(300);

        await whenVisible();
        await setStatus('Loading');
        counterWrap.classList.add('is-visible');
        barWrap.classList.add('is-visible');
        await runCounter(900);
        await wait(200);

        // Don't reveal the page until its assets have finished loading
        // (max 4s extra), so it never opens half-rendered.
        await waitForPageLoad(4000);
        closeLoader();
    }

    // Failsafe: whatever happens, never leave the loader stuck.
    setTimeout(closeLoader, 12000);
    sequence().catch(closeLoader);
})();

(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════════════
    //  01 · CORE — Lenis smooth scroll, scroll hub, helpers
    // ════════════════════════════════════════════════════════════════════

    // ─── SMOOTH SCROLL ENGINE (LENIS) — same duration/easing curve Lenis
    // uses on lenis.dev itself: a 1.2s eased-out-expo glide that makes
    // every wheel/trackpad tick continue drifting instead of stopping
    // dead, applied to the whole page (Home, Skills, Education, Contact),
    // not just anchor-link jumps. Touch keeps the browser's native momentum
    // scrolling (it's the smoothest option on phones).
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Exact feel of lenis.dev: time-based glide (duration + exponential ease-out)
    // instead of a plain lerp, so every wheel tick travels in one long, silky
    // deceleration. (When `lerp` is set, Lenis ignores duration/easing — that
    // is why the old setting felt choppy/short.)
    // If the Lenis CDN is blocked/offline, fall back to a tiny native-scroll
    // shim with the same API so the rest of the page keeps working.
    function createNativeScroller() {
        const root = document.documentElement;
        return {
            stop() { root.style.overflow = 'hidden'; },
            start() { root.style.overflow = ''; },
            resize() { },
            raf() { },
            on(evt, fn) { if (evt === 'scroll') window.addEventListener('scroll', fn, { passive: true }); },
            scrollTo(target, opts) {
                const y = typeof target === 'number'
                    ? target
                    : target.getBoundingClientRect().top + window.scrollY;
                window.scrollTo({ top: y, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
            }
        };
    }

    const lenis = (typeof Lenis !== 'undefined')
        ? new Lenis({
            duration: 1.15,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),   // lenis.dev default curve
            orientation: 'vertical',
            gestureOrientation: 'vertical',
            smoothWheel: !prefersReducedMotion,
            wheelMultiplier: 1,
            touchMultiplier: 1.5,
            syncTouch: false,                // native touch momentum = smoothest on phones
        })
        : createNativeScroller();
    window.lenis = lenis;

    // Motion is progressive: elements are only pre-hidden once JS has confirmed it is running.
    document.documentElement.classList.add('motion-on');
    let readyResolve;
    const ready = new Promise(res => { readyResolve = res; });

    // Hold the page still while the intro loader is up, then release it.
    lenis.stop();
    (function () {
        const loader = document.getElementById('loader');
        function release() {
            lenis.start(); lenis.resize();
            document.querySelectorAll('#skills-video, #contact-video').forEach(v => {
                v.preload = 'auto';
                const p = v.play(); if (p && p.catch) p.catch(() => { });
            });
            // the page "arrives": navbar, hero and text reveals are gated on this moment
            setTimeout(() => { document.documentElement.classList.add('is-ready'); readyResolve(); }, 150);
        }
        if (!loader || getComputedStyle(loader).display === 'none') { release(); return; }
        const mo = new MutationObserver(() => {
            if (loader.classList.contains('hide') || loader.style.display === 'none') {
                mo.disconnect(); release();
            }
        });
        mo.observe(loader, { attributes: true, attributeFilter: ['class', 'style'] });
        setTimeout(release, 13000);     // failsafe (release is idempotent enough: class add + resolve)
    })();
    window.addEventListener('load', () => lenis.resize());

    // ONE scroll hub: every scroll-linked effect runs synchronously inside
    // Lenis's own frame. (Before, each effect scheduled its own rAF from a
    // scroll event, so everything painted one frame behind the scroll.)
    const scrollHooks = [];
    function onScrollHook(fn) { scrollHooks.push(fn); }
    // Mobile browsers fire `resize` every time the address bar collapses/expands
    // while scrolling (height-only change). Re-measuring the page on each one
    // causes forced layouts mid-scroll = jank. Only react when the width changes
    // (rotation / real resize); heavy handlers coalesce into one rAF.
    function onWidthResize(fn) {
        let w = window.innerWidth, id = 0;
        window.addEventListener('resize', () => {
            if (window.innerWidth === w) return;
            w = window.innerWidth;
            if (id) cancelAnimationFrame(id);
            id = requestAnimationFrame(() => { id = 0; fn(); });
        });
    }
    // Rect cache valid only inside one scroll dispatch: several hooks read the
    // same element's rect after earlier hooks wrote styles, which forced a full
    // layout every frame. Caching the first read removes that thrash.
    let _inDispatch = false;
    const _rectCache = new Map();
    function cachedRect(el) {
        if (!_inDispatch) return el.getBoundingClientRect();
        let r = _rectCache.get(el);
        if (!r) { r = el.getBoundingClientRect(); _rectCache.set(el, r); }
        return r;
    }
    lenis.on('scroll', () => {
        _rectCache.clear();
        _inDispatch = true;
        for (let i = 0; i < scrollHooks.length; i++) scrollHooks[i]();
        _inDispatch = false;
    });

    // Pause every CSS animation inside sections that are off-screen
    // (floating blobs, marquee, rail flow...) so they cost nothing while scrolling.
    if ('IntersectionObserver' in window) {
        const animIO = new IntersectionObserver(es => {
            es.forEach(e => e.target.toggleAttribute('data-offscreen', !e.isIntersecting));
        }, { rootMargin: '200px 0px' });
        document.querySelectorAll('section, footer').forEach(el => animIO.observe(el));
    }

    // Tells scroll-linked code whether an element is near the viewport so
    // off-screen sections do zero work while scrolling.
    function watchVisible(el, margin, cb) {
        let visible = true;
        if (el && 'IntersectionObserver' in window) {
            new IntersectionObserver(es => {
                visible = es[es.length - 1].isIntersecting;
                if (cb) cb(visible);
            }, { rootMargin: margin }).observe(el);
        }
        return () => visible;
    }

    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);


    // ════════════════════════════════════════════════════════════════════
    //  02 · CURSOR
    // ════════════════════════════════════════════════════════════════════

    (function () {
        // ─── CURSOR (transform-based, rAF-throttled — avoids layout thrash) ────
        const dot = document.getElementById('cursorDot');
        const ring = document.getElementById('cursorRing');
        const hasFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (!hasFinePointer) { dot.style.display = 'none'; ring.style.display = 'none'; }
        // Labelled morph: any [data-cursor="Text"] turns the ring into a disc with that text
        if (hasFinePointer) {
            document.addEventListener('mouseover', e => {
                const el = e.target.closest && e.target.closest('[data-cursor]');
                if (el) { ring.textContent = el.dataset.cursor; ring.classList.add('has-label'); dot.classList.add('is-hidden'); }
                else if (ring.classList.contains('has-label')) { ring.textContent = ''; ring.classList.remove('has-label'); dot.classList.remove('is-hidden'); }
            }, { passive: true });
        }
        let cursorX = 0, cursorY = 0, cursorQueued = false;
        if (hasFinePointer) document.addEventListener('mousemove', e => {
            cursorX = e.clientX; cursorY = e.clientY;
            if (!cursorQueued) {
                cursorQueued = true;
                requestAnimationFrame(() => {
                    const t = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
                    dot.style.transform = t;
                    ring.style.transform = t;
                    cursorQueued = false;
                });
            }
        }, { passive: true });
        document.querySelectorAll('a, button, .sk-card, .svc-card, .editorial-contact-card, .premium-email-hero-box, .tl-card').forEach(el => {
            el.addEventListener('mouseenter', () => { dot.style.width = '18px'; dot.style.height = '18px'; ring.style.width = '52px'; ring.style.height = '52px'; ring.style.borderColor = 'rgba(255,77,136,.7)'; });
            el.addEventListener('mouseleave', () => { dot.style.width = '10px'; dot.style.height = '10px'; ring.style.width = '36px'; ring.style.height = '36px'; ring.style.borderColor = 'rgba(255,77,136,.5)'; });
        });
    })();


    // ════════════════════════════════════════════════════════════════════
    //  03 · NAVBAR — scroll state, active link, anchors, indicator, mobile menu
    // ════════════════════════════════════════════════════════════════════

    (function () {
        // ─── NAV SCROLL + ACTIVE NAV LINK (rAF-throttled) ──────────────────────
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.nav-links a, .mobile-menu a');
        const headerEl = document.getElementById('header');
        let secTops = [], maxScroll = 1;
        function measureSections() {
            secTops = Array.from(sections, s => ({ id: s.id, top: s.offsetTop }));
            maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        }
        let lastScrolled = null, lastCurrent = null, lastY = 0, navHidden = false;
        let pendingP = '0', lastP = '', pQueued = false;
        function setNavHidden(v) {
            if (v === navHidden) return;
            navHidden = v;
            headerEl.classList.toggle('nav-hidden', v);
        }
        function syncNav() {
            const y = window.scrollY;
            const scrolled = y > 60;
            if (scrolled !== lastScrolled) {
                lastScrolled = scrolled;
                headerEl.classList.toggle('scrolled', scrolled);
            }
            let current = '';
            for (let i = 0; i < secTops.length; i++) {
                if (y >= secTops[i].top - 200) current = secTops[i].id;
            }
            if (current !== lastCurrent) {
                lastCurrent = current;
                navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + current));
            }
            // scroll-progress line inside the capsule
            pendingP = Math.min(1, Math.max(0, y / maxScroll)).toFixed(3);
            if (pendingP !== lastP && !pQueued) {
                pQueued = true;
                requestAnimationFrame(() => { pQueued = false; lastP = pendingP; headerEl.style.setProperty('--p', pendingP); });
            }
            // smart hide: away while scrolling down, back as soon as you scroll up
            const dy = y - lastY;
            if (Math.abs(dy) > 5) {
                setNavHidden(dy > 0 && y > 480 && !document.body.classList.contains('menu-open'));
                lastY = y;
            }
        }
        // mouse near the top edge brings a hidden navbar back
        document.addEventListener('mousemove', e => { if (navHidden && e.clientY < 70) setNavHidden(false); }, { passive: true });
        measureSections();
        onScrollHook(syncNav);
        window.addEventListener('load', () => { measureSections(); syncNav(); });
        window.addEventListener('resize', () => { measureSections(); syncNav(); });
        if ('ResizeObserver' in window) new ResizeObserver(() => { measureSections(); syncNav(); }).observe(document.body);
        syncNav();
    })();


    // ─── NAV: sliding gradient underline follows hover / active link ────────
    (function () {
        const ul = document.querySelector('.nav-links');
        const ind = ul && ul.querySelector('.nav-indicator');
        if (!ind) return;
        const PAD = 14;                                   // matches the link's horizontal padding
        const links = Array.from(ul.querySelectorAll('a'));
        const getActive = () => ul.querySelector('a.active');
        function moveTo(a) {
            const li = a && a.parentElement;
            if (!li || !li.offsetWidth) { ind.style.opacity = 0; return; }
            ind.style.opacity = 1;
            ind.style.width = (li.offsetWidth - PAD * 2) + 'px';
            ind.style.transform = 'translateX(' + (li.offsetLeft + PAD) + 'px)';
        }
        ind.style.transition = 'none';
        moveTo(getActive());
        requestAnimationFrame(() => requestAnimationFrame(() => { ind.style.transition = ''; }));

        links.forEach(a => {
            a.addEventListener('mouseenter', () => moveTo(a));
            a.addEventListener('focus', () => moveTo(a));
        });
        ul.addEventListener('mouseleave', () => moveTo(getActive()));
        ul.addEventListener('focusout', () => moveTo(getActive()));
        new MutationObserver(() => { if (!ul.matches(':hover')) moveTo(getActive()); })
            .observe(ul, { subtree: true, attributes: true, attributeFilter: ['class'] });
        // the capsule changes width when the page scrolls, so re-measure as it animates
        const nav = ul.closest('.nav');
        if (nav) nav.addEventListener('transitionend', () => moveTo(ul.matches(':hover') ? ul.querySelector('a:hover') : getActive()));
        window.addEventListener('resize', () => moveTo(getActive()));
        window.addEventListener('load', () => moveTo(getActive()));
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveTo(getActive()));
    })();

    (function () {
        // ─── SMOOTH SCROLL (ANCHOR LINKS) ──────────────────────────────────────
        document.querySelectorAll('a[href^="#"]').forEach(a => {
            a.addEventListener('click', e => {
                const href = a.getAttribute('href');
                if (href === '#' || href === '') return;
                const t = document.querySelector(href);
                if (t) {
                    e.preventDefault();
                    // If the mobile menu is open, Lenis is stopped (scroll lock) and would
                    // silently ignore scrollTo(). Close the menu first so scrolling resumes.
                    if (document.body.classList.contains('menu-open') && window.closeMobileMenu) {
                        window.closeMobileMenu();
                    }
                    const dist = Math.abs(t.getBoundingClientRect().top);
                    lenis.scrollTo(t, {
                        force: true,
                        offset: 0,
                        duration: Math.min(2.4, Math.max(1.0, dist / 1600)),
                        easing: x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,   // easeInOutCubic
                    });
                }
            });
        });
    })();


    // ─── HAMBURGER MOBILE MENU ───────────────────────────────────────────────
    (function () {
        const btn = document.getElementById('navHamburger');
        const menu = document.getElementById('mobileMenu');
        if (!btn || !menu) return;

        function toggleMenu(force) {
            const isOpen = force !== undefined ? force : !btn.classList.contains('open');
            btn.classList.toggle('open', isOpen);
            btn.setAttribute('aria-expanded', isOpen);
            if (isOpen) {
                menu.style.display = 'flex';
                requestAnimationFrame(() => menu.classList.add('open'));
            } else {
                menu.classList.remove('open');
                setTimeout(() => { if (!menu.classList.contains('open')) menu.style.display = 'none'; }, 450);
            }
            document.body.classList.toggle('menu-open', isOpen);
            if (isOpen) { lenis.stop(); } else { lenis.start(); }
            if (isOpen) document.getElementById('header').classList.remove('nav-hidden');
        }

        window.closeMobileMenu = () => {
            if (btn.classList.contains('open')) toggleMenu(false);
        };

        btn.addEventListener('click', () => toggleMenu());

        // Close on nav link click (non-anchor links like "Download CV" / "Hire Me")
        menu.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => window.closeMobileMenu());
        });

        // Close on Escape
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') window.closeMobileMenu();
        });

        // Close on resize to desktop
        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) window.closeMobileMenu();
        });
    })();


    // ════════════════════════════════════════════════════════════════════
    //  04 · SHARED REVEAL ENGINES — reveal, zoom-fade, split titles, scroll-trigger engine
    // ════════════════════════════════════════════════════════════════════

    (function () {
        // ─── REVEAL INTERFACE ENGINE ───────────────────────────────────────────
        const premiumScrollEngine = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;

                const element = entry.target;
                element.classList.add('active');

                premiumScrollEngine.unobserve(element);
            });
        }, {
            root: null,
            rootMargin: '0px 0px -10% 0px',
            threshold: 0.05
        });

        document.querySelectorAll('.modern-reveal-text, .modern-reveal-container').forEach(item => {
            premiumScrollEngine.observe(item);
        });

        // ─── ZOOM-FADE TEXT REVEAL ENGINE ───────────────────────────────────────
        const zoomFadeEngine = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('active');
                zoomFadeEngine.unobserve(entry.target);
            });
        }, {
            root: null,
            rootMargin: '0px 0px -8% 0px',
            threshold: 0.2
        });

        document.querySelectorAll('.zoom-fade').forEach(item => {
            zoomFadeEngine.observe(item);
        });

        // ─── SPLIT-TITLE SCROLL REVEAL (re-triggers on scroll down AND up) ──────
        const splitTitleEngine = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                entry.target.classList.toggle('in-view', entry.isIntersecting);
            });
        }, {
            root: null,
            rootMargin: '0px 0px -12% 0px',
            threshold: 0.25
        });

        document.querySelectorAll('[data-split-title]').forEach(item => {
            splitTitleEngine.observe(item);
        });
    })();


    // ─── SCROLL-TRIGGER ENGINE (Lenis-style, scroll-scrubbed) ──────────────
    // Every [data-scrub] element (and each .svc-card) gets a progress value
    // --p (0 → 1) computed from where it sits in the viewport. Because Lenis
    // glides the real scroll position, the motion is buttery and fully
    // reversible: scroll down and things rise/fade/scale in, scroll up and
    // they ease back out. [data-parallax] elements drift at their own speed.
    // Geometry is measured with offsetTop chains (transform-free), cached on
    // resize, so there is no feedback loop and no layout thrash per frame.
    (function () {
        const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
        const easeOut = t => 1 - Math.pow(1 - t, 3);
        const scrubEls = Array.from(document.querySelectorAll('[data-scrub], .svc-card'));
        const parEls = Array.from(document.querySelectorAll('[data-parallax]'));
        const heroInner = document.querySelector('#home .hero-inner');
        const docTop = el => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y; };

        // HOME / HERO: no scroll-down parallax (drift, fade, shrink). Mouse-depth effect is kept.
        const heroSection = document.getElementById('home');
        const inHero = el => !!(heroSection && heroSection.contains(el));

        const S = scrubEls.map(el => ({ el, top: 0, h: 0, row: 0, p: -1 }));
        const P = parEls.map(el => ({ el, top: 0, h: 0, k: inHero(el) ? 0 : (parseFloat(el.dataset.parallax) || 0), abs: el.hasAttribute('data-parallax-scroll'), v: null, m: parseFloat(el.dataset.mouse) || 0, mx: 0, my: 0 }));
        const applyTranslate = o => { o.el.style.translate = o.mx.toFixed(1) + 'px ' + ((o.v || 0) + o.my).toFixed(1) + 'px'; };

        function measure() {
            S.forEach(s => { s.top = docTop(s.el); s.h = s.el.offsetHeight; });
            // stagger cards that sit in the same row (left → right)
            S.forEach((s, i) => { s.row = S.slice(0, i).filter(o => Math.abs(o.top - s.top) < 4 && o.el.parentElement === s.el.parentElement).length; });
            P.forEach(o => { o.top = docTop(o.el); o.h = o.el.offsetHeight; });
            update();
        }

        function update() {
            const y = window.scrollY, vh = window.innerHeight;

            for (let i = 0; i < S.length; i++) {
                const s = S[i];
                const screenTop = s.top - y;
                if (screenTop > vh * 1.6 || screenTop + s.h < -vh * 0.6) {
                    // far off-screen: park at the correct end state, no work
                    const end = screenTop > 0 ? 0 : 1;
                    if (s.p !== end) { s.p = end; s.el.style.setProperty('--p', end); }
                    continue;
                }
                const delay = s.row * 0.06 * vh;
                const raw = (vh * 0.98 - screenTop - delay) / (vh * 0.52);
                const p = prefersReducedMotion ? 1 : easeOut(clamp(raw, 0, 1));
                if (Math.abs(p - s.p) > 0.002) { s.p = p; s.el.style.setProperty('--p', p.toFixed(3)); }
            }

            if (!prefersReducedMotion) {
                for (let i = 0; i < P.length; i++) {
                    const o = P[i];
                    const off = o.abs ? y * o.k : ((y + vh / 2) - (o.top + o.h / 2)) * o.k;
                    const v = Math.round(off * 10) / 10;
                    if (v !== o.v) { o.v = v; applyTranslate(o); }
                }
            }
        }

        measure();
        onScrollHook(update);
        window.addEventListener('load', measure);
        onWidthResize(measure);
        if ('ResizeObserver' in window) { let ro = 0; new ResizeObserver(() => { if (ro) return; ro = requestAnimationFrame(() => { ro = 0; measure(); }); }).observe(document.body); }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

        // Mouse parallax (depth): hero layers shift against the cursor at different
        // strengths and glide with a lerp, layered on top of the scroll parallax.
        const mouseEls = P.filter(o => o.m);
        const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (mouseEls.length && finePointer && !prefersReducedMotion) {
            let tx = 0, ty = 0, running = false, heroVisible = true;
            const loop = () => {
                let moving = false;
                mouseEls.forEach(o => {
                    const gx = tx * o.m, gy = ty * o.m * 0.6;
                    o.mx += (gx - o.mx) * 0.07; o.my += (gy - o.my) * 0.07;
                    if (Math.abs(gx - o.mx) > 0.05 || Math.abs(gy - o.my) > 0.05) moving = true;
                    applyTranslate(o);
                });
                running = moving;
                if (moving) requestAnimationFrame(loop);
            };
            window.addEventListener('mousemove', e => {
                tx = (e.clientX / window.innerWidth - 0.5) * 2;
                ty = (e.clientY / window.innerHeight - 0.5) * 2;
                if (!running && heroVisible) { running = true; requestAnimationFrame(loop); }
            }, { passive: true });
            const home = document.getElementById('home');
            if (home && 'IntersectionObserver' in window) {
                new IntersectionObserver(es => { heroVisible = es[es.length - 1].isIntersecting; }, { rootMargin: '100px 0px' }).observe(home);
            }
        }
    })();


    // ─── MASKED WORD REVEAL (offset / stagger) ─────────────────────────────
    // [data-split-words] text is split into words that slide up out of a clipped
    // line one after another; replays every time the text re-enters the viewport.
    (function () {
        const els = Array.from(document.querySelectorAll('[data-split-words]'));
        if (!els.length) return;
        els.forEach(el => {
            const text = el.textContent.trim();
            el.setAttribute('aria-label', text);
            el.textContent = '';
            text.split(/\s+/).forEach((word, i, all) => {
                const mask = document.createElement('span');
                mask.className = 'w';
                mask.setAttribute('aria-hidden', 'true');
                const inner = document.createElement('span');
                inner.textContent = word;
                inner.style.setProperty('--i', i);
                mask.appendChild(inner);
                el.appendChild(mask);
                if (i < all.length - 1) el.appendChild(document.createTextNode(' '));
            });
        });
        const io = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('words-in', e.isIntersecting)),
            { rootMargin: '0px 0px -8% 0px', threshold: 0.2 });
        ready.then(() => els.forEach(el => io.observe(el)));
    })();


    // ════════════════════════════════════════════════════════════════════
    //  05 · HOME / HERO — reveal + magnetic portrait
    // ════════════════════════════════════════════════════════════════════

    // ─── HOME / HERO: SCROLL TRIGGER REVEAL (re-fires both ways) ───────────
    // Same bidirectional pattern as the rest of the page: the hero copy
    // and portrait ease in staggered on entry, and reset so they replay
    // every time #home scrolls back into view — down into it initially,
    // or back up to it later.
    (function () {
        const heroInner = document.querySelector('#home .hero-inner');
        if (!heroInner) return;

        const heroRevealEngine = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                entry.target.classList.toggle('in-view', entry.isIntersecting);
            });
        }, {
            root: null,
            rootMargin: '0px 0px -5% 0px',
            threshold: 0.15
        });

        ready.then(() => heroRevealEngine.observe(heroInner));
    })();

    (function () {
        // ─── MAGNETIC PORTRAIT ──────────────────────────────────────────────────
        class MagneticPortrait {
            constructor(canvasId, imgId, options = {}) {
                this.canvas = document.getElementById(canvasId);
                this.img = document.getElementById(imgId);
                this.ctx = this.canvas.getContext('2d');
                this.particles = [];
                this.mouse = { x: undefined, y: undefined };
                this.attractionRadius = options.radius || 210;
                this.returnStrength = options.returnStrength || 0.045;
                this.particleBaseSize = options.size || 1.6;
                this.gapSize = options.gap || 3;
                this.animationFrame = null;
                this.resizeTimer = null;
                this.init();
            }
            init() {
                if (this.img.complete && this.img.naturalWidth > 0) { this.setupFromImage(); }
                else { this.img.onload = () => this.setupFromImage(); }
                this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
                this.canvas.addEventListener('mouseleave', () => { this.mouse.x = undefined; this.mouse.y = undefined; });
                window.addEventListener('resize', this.debouncedResize.bind(this));
            }
            debouncedResize() {
                clearTimeout(this.resizeTimer);
                this.resizeTimer = setTimeout(() => { if (this.img.complete && this.img.naturalWidth > 0) this.regenerateParticlesFromImage(); }, 120);
            }
            regenerateParticlesFromImage() {
                const rect = this.img.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                this.canvas.width = rect.width; this.canvas.height = rect.height;
                const hc = document.createElement('canvas');
                const hx = hc.getContext('2d');
                const nw = this.img.naturalWidth, nh = this.img.naturalHeight;
                hc.width = nw; hc.height = nh;
                hx.drawImage(this.img, 0, 0, nw, nh);
                try {
                    const data = hx.getImageData(0, 0, nw, nh).data;
                    const gap = this.gapSize;
                    const sx = this.canvas.width / nw, sy = this.canvas.height / nh;
                    const newParticles = [];
                    for (let y = 0; y < nh; y += gap) {
                        for (let x = 0; x < nw; x += gap) {
                            const i = (y * nw + x) * 4;
                            if (i >= data.length) continue;
                            if (data[i + 3] > 35) {
                                const ox = x * sx, oy = y * sy;
                                newParticles.push({ x: ox, y: oy, origX: ox, origY: oy, vx: 0, vy: 0, color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`, size: this.particleBaseSize });
                            }
                        }
                    }
                    this.particles = newParticles;
                    if (!this.animationFrame) this.startAnimation();
                } catch (e) { }
            }
            setupFromImage() {
                const rect = this.img.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) { requestAnimationFrame(() => this.setupFromImage()); return; }
                this.canvas.width = rect.width; this.canvas.height = rect.height;
                this.regenerateParticlesFromImage();
                this.startAnimation();
            }
            handleMouseMove(e) {
                const rect = this.canvas.getBoundingClientRect();
                const sx = this.canvas.width / rect.width, sy = this.canvas.height / rect.height;
                this.mouse.x = Math.min(Math.max((e.clientX - rect.left) * sx, 0), this.canvas.width);
                this.mouse.y = Math.min(Math.max((e.clientY - rect.top) * sy, 0), this.canvas.height);
            }
            updateParticles() {
                const hasMouse = this.mouse.x !== undefined;
                const radius = this.attractionRadius;
                for (const p of this.particles) {
                    if (hasMouse) {
                        const dx = this.mouse.x - p.x, dy = this.mouse.y - p.y;
                        const dist = Math.hypot(dx, dy);
                        if (dist < radius) {
                            const force = (radius - dist) / radius;
                            const ang = Math.atan2(dy, dx);
                            p.vx += Math.cos(ang) * force * 7.2;
                            p.vy += Math.sin(ang) * force * 7.2;
                        } else {
                            p.vx += (p.origX - p.x) * this.returnStrength;
                            p.vy += (p.origY - p.y) * this.returnStrength;
                        }
                    } else {
                        p.vx += (p.origX - p.x) * 0.04;
                        p.vy += (p.origY - p.y) * 0.04;
                    }
                    p.x += p.vx; p.y += p.vy;
                    p.vx *= 0.84; p.vy *= 0.84;
                    p.x = Math.min(Math.max(p.x, -2), this.canvas.width + 2);
                    p.y = Math.min(Math.max(p.y, -2), this.canvas.height + 2);
                }
            }
            draw() {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                for (const p of this.particles) {
                    this.ctx.fillStyle = p.color;
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
            animate() {
                this.updateParticles(); this.draw();
                this.animationFrame = requestAnimationFrame(() => this.animate());
            }
            startAnimation() {
                if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
                this.animationFrame = requestAnimationFrame(() => this.animate());
            }
            stopAnimation() {
                if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
        }

        const portrait = new MagneticPortrait('portrait-canvas', 'portrait-img', {
            radius: 220, returnStrength: 0.05, size: 1.8, gap: 3
        });

        window.addEventListener('load', () => {
            setTimeout(() => { if (portrait.img.complete) portrait.regenerateParticlesFromImage(); }, 100);
            const w = document.getElementById('portrait-wrapper');
            if (w && 'ResizeObserver' in window) {
                new ResizeObserver(() => { if (portrait.img.complete) portrait.regenerateParticlesFromImage(); }).observe(w);
            }

            // Pause the canvas particle loop while off-screen — frees up main-thread
            // time during scroll instead of animating a portrait nobody can see.
            if (w) {
                const visibilityObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            if (!portrait.animationFrame) portrait.startAnimation();
                        } else {
                            portrait.stopAnimation();
                        }
                    });
                }, { threshold: 0 });
                visibilityObserver.observe(w);
            }
        });

        let safetyCount = 0;
        const safetyTimer = setInterval(() => {
            if (portrait.particles.length > 100) { clearInterval(safetyTimer); return; }
            if (safetyCount++ > 5 && portrait.img.complete && portrait.particles.length === 0)
                portrait.regenerateParticlesFromImage();
        }, 700);
    })();


    // ════════════════════════════════════════════════════════════════════
    //  06 · SKILLS — background video parallax, floating logos, robot
    // ════════════════════════════════════════════════════════════════════

    // ─── VIDEO PARALLAX ───────────────────────────────
    // Geometry is cached (no getBoundingClientRect per frame), only sections
    // near the viewport do any work, and each video pauses while off-screen
    // so two videos aren't decoding at once.
    (function () {
        const PARALLAX_SPEED = 0.4;
        const MOBILE_BREAKPOINT = 768;
        const MOBILE_STICKY_OFFSET = 26;
        const skillsVideoBg = document.getElementById('skills-video-bg');
        const layers = [
            { section: document.getElementById('skills'), video: document.getElementById('skills-video'), mobileSticky: true },
            { section: document.getElementById('contact'), video: document.getElementById('contact-video'), mobileSticky: false },
        ].filter(l => l.section && l.video);
        layers.forEach(l => { l.top = 0; l.height = 0; l.visible = true; l.lastOffset = null; });
        const skillsLayer = layers.find(l => l.mobileSticky);

        let vw = window.innerWidth, vh = window.innerHeight;
        let pinState = '';

        function measure() {
            vw = window.innerWidth; vh = window.innerHeight;
            const y = window.scrollY;
            layers.forEach(l => {
                l.top = l.section.getBoundingClientRect().top + y;
                l.height = l.section.offsetHeight;
                l.lastOffset = null;
            });
            pinState = '';
        }

        // Mobile: keep the skills video pinned to the viewport while the tall
        // section is on screen. State is computed from cached geometry and the
        // DOM is only touched when the state actually changes.
        function updatePin(layer, y) {
            if (!skillsVideoBg) return;
            const s = skillsVideoBg.style;
            if (vw > MOBILE_BREAKPOINT) {
                if (pinState !== 'desktop') {
                    pinState = 'desktop';
                    s.position = ''; s.top = ''; s.bottom = ''; s.left = ''; s.right = ''; s.height = '';
                }
                return;
            }
            const top = layer.top - y;
            const bottom = top + layer.height;
            const state = top >= 0 ? 'top' : (bottom <= vh ? 'bottom' : 'fixed');
            if (state === pinState) return;
            pinState = state;
            s.left = '0'; s.right = '0'; s.height = vh + 'px';
            if (state === 'top') { s.position = 'absolute'; s.top = '0'; s.bottom = ''; }
            else if (state === 'bottom') { s.position = 'absolute'; s.top = ''; s.bottom = '0'; }
            else { s.position = 'fixed'; s.top = '0'; s.bottom = ''; }
        }

        function update() {
            const y = window.scrollY;
            if (skillsLayer) updatePin(skillsLayer, y);
            const mobile = vw <= MOBILE_BREAKPOINT;
            for (let i = 0; i < layers.length; i++) {
                const l = layers[i];
                if (!l.visible) continue;
                let offset, tf;
                if (mobile && l.mobileSticky) {
                    const scrollable = l.height - vh;
                    let p = scrollable > 0 ? (y - l.top) / scrollable : 0;
                    p = Math.min(1, Math.max(0, p));
                    offset = Math.round((p - 0.5) * MOBILE_STICKY_OFFSET * 10) / 10;
                    if (offset === l.lastOffset) continue;
                    tf = `translate3d(-50%, calc(-50% + ${offset}px), 0) scale(1.12)`;
                } else {
                    offset = Math.round((y - l.top) * PARALLAX_SPEED * 10) / 10;
                    if (offset === l.lastOffset) continue;
                    tf = `translate3d(-50%, calc(-50% + ${offset}px), 0)`;
                }
                l.lastOffset = offset;
                l.video.style.transform = tf;
            }
        }

        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver(entries => {
                entries.forEach(e => {
                    const l = layers.find(x => x.section === e.target);
                    if (!l) return;
                    l.visible = e.isIntersecting;
                    if (e.isIntersecting) {
                        const p = l.video.play();
                        if (p && p.catch) p.catch(() => { });
                    } else {
                        l.video.pause();
                    }
                });
                update();
            }, { rootMargin: '150px 0px' });
            layers.forEach(l => io.observe(l.section));
        }

        measure();
        update();
        onScrollHook(update);
        const remeasure = () => { measure(); update(); };
        window.addEventListener('load', remeasure);
        onWidthResize(remeasure);
        if ('ResizeObserver' in window) { let ro = 0; new ResizeObserver(() => { if (ro) return; ro = requestAnimationFrame(() => { ro = 0; remeasure(); }); }).observe(document.body); }
    })();

    // ===== FLOATING MAGNETIC LOGOS (Skills & Education titles) =====
    // Each chip bobs up/down and spins slowly on its own clock, and eases
    // away from the cursor when it wanders close — a light "magnetic"
    // repulsion in the same spirit as the hero portrait effect above.
    // Runs once per `.skills-title-stage` found on the page, so both the
    // "Technical Skills" and "Education & Certifications" headings get
    // their own independent set of chips.
    (function () {
        const stages = document.querySelectorAll('.skills-title-stage');
        if (!stages.length) return;

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const mouse = { x: -9999, y: -9999 };

        const controllers = [];

        stages.forEach(stage => {
            const wrap = stage.querySelector('.floating-logos');
            if (!wrap) return;

            const chips = Array.from(wrap.querySelectorAll('.floating-logo')).map((el, i) => ({
                el,
                phase: Math.random() * Math.PI * 2,
                bobSpeed: 0.5 + Math.random() * 0.4,
                bobAmp: 7 + Math.random() * 6,
                rotSpeed: (i % 2 === 0 ? 1 : -1) * (5 + Math.random() * 9),
                pushX: 0,
                pushY: 0,
                baseX: 0,
                baseY: 0
            }));

            if (reduceMotion) {
                // Respect the user's preference: just fade the chips in, no motion.
                const staticObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => wrap.classList.toggle('in-view', entry.isIntersecting));
                }, { threshold: 0.05 });
                staticObserver.observe(stage);
                return;
            }

            let running = false;
            let rafId = null;
            let t0 = null;

            function measure() {
                const wrapRect = wrap.getBoundingClientRect();
                chips.forEach(c => {
                    const r = c.el.getBoundingClientRect();
                    c.baseX = r.left + r.width / 2 - wrapRect.left;
                    c.baseY = r.top + r.height / 2 - wrapRect.top;
                });
            }

            function frame(now) {
                if (!t0) t0 = now;
                const t = (now - t0) / 1000;
                const wrapRect = wrap.getBoundingClientRect();
                const radius = 130;

                chips.forEach(c => {
                    const bob = Math.sin(t * c.bobSpeed + c.phase) * c.bobAmp;
                    const rot = t * c.rotSpeed;

                    const cx = wrapRect.left + c.baseX;
                    const cy = wrapRect.top + c.baseY + bob;
                    const dx = cx - mouse.x;
                    const dy = cy - mouse.y;
                    const dist = Math.hypot(dx, dy);

                    let targetPushX = 0, targetPushY = 0;
                    if (dist < radius) {
                        const force = (radius - dist) / radius;
                        const ang = Math.atan2(dy, dx);
                        targetPushX = Math.cos(ang) * force * 34;
                        targetPushY = Math.sin(ang) * force * 34;
                    }
                    c.pushX += (targetPushX - c.pushX) * 0.08;
                    c.pushY += (targetPushY - c.pushY) * 0.08;

                    c.el.style.transform =
                        `translate3d(${c.pushX.toFixed(2)}px, ${(bob + c.pushY).toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg)`;
                });

                rafId = requestAnimationFrame(frame);
            }

            function start() {
                if (running) return;
                running = true;
                measure();
                t0 = null;
                rafId = requestAnimationFrame(frame);
            }

            function stop() {
                running = false;
                if (rafId) cancelAnimationFrame(rafId);
                rafId = null;
            }

            // Only animate while this title is actually on screen.
            const visibilityObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    wrap.classList.toggle('in-view', entry.isIntersecting);
                    if (entry.isIntersecting) start(); else stop();
                });
            }, { threshold: 0.05 });
            visibilityObserver.observe(stage);

            controllers.push({ measure });
        });

        if (reduceMotion || !controllers.length) return;

        window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
        document.documentElement.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });
        window.addEventListener('resize', () => controllers.forEach(c => c.measure()));
    })();

    // ─── SKILLS ROBOT: frame sequence driven by the mouse ─────────────────
    // frames/frame(1).png … frame(120).png. Pointer X sweeps the sequence
    // (left → right), hovering a card turns the robot to that skill, and
    // clicking/tapping the robot pokes it (squash & stretch + speech bubble).
    (function () {
        const stage = document.getElementById('skStage');
        const canvas = document.getElementById('skCanvas');
        if (!stage || !canvas) return;
        const section = document.getElementById('skills');
        const wrap = document.getElementById('skWrap');
        const bubble = document.getElementById('skBubble');
        const label = document.getElementById('skLabel');
        const cards = Array.from(stage.querySelectorAll('.sk-card'));
        const ctx = canvas.getContext('2d');

        const TOTAL = 120;
        const SRC = { x: 760, y: 150, w: 1040, h: 1200 };   // crop of the 2560x1440 frame around the robot
        const path = n => `frames/frame%20(${n}).png`;   // files are named "frame (N).png" (with a space)
        const imgs = new Array(TOTAL + 1);
        const ok = new Uint8Array(TOTAL + 1);

        const TOUCH = window.matchMedia('(hover: none)').matches;
        const HELLO = TOUCH ? 'Hi! Tap me 👋' : 'Hi! Move your mouse 👋';
        const HINT = TOUCH ? 'Psst… tap a card 👀' : 'Psst… hover a card 👀';
        let cur = 1, target = 1, drawn = -1, dpr = 1, lastInput = performance.now(), idle = false, active = null;
        let inView = false, bubbleTimer = null, idleDir = 1;
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

        function fit() {
            const r = canvas.getBoundingClientRect();
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.round(r.width * dpr));
            canvas.height = Math.max(1, Math.round(r.height * dpr));
            drawn = -1; draw();
        }

        function nearestLoaded(n) {
            if (ok[n]) return n;
            for (let d = 1; d < TOTAL; d++) {
                if (n - d >= 1 && ok[n - d]) return n - d;
                if (n + d <= TOTAL && ok[n + d]) return n + d;
            }
            return 0;
        }

        function draw() {
            const f = nearestLoaded(cur);
            if (!f || f === drawn) return;
            drawn = f;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(imgs[f], SRC.x, SRC.y, SRC.w, SRC.h, 0, 0, canvas.width, canvas.height);
        }

        // load key poses first, then everything else in small batches
        function load() {
            const keys = cards.map(c => +c.dataset.frame);
            const order = [...keys];
            for (let i = 1; i <= TOTAL; i++) if (!keys.includes(i)) order.push(i);
            let idx = 0;
            function next() {
                const end = Math.min(idx + 10, order.length);
                for (; idx < end; idx++) {
                    const n = order[idx], im = new Image();
                    im.decoding = 'async';
                    im.onload = () => { imgs[n] = im; ok[n] = 1; if (n === Math.round(cur)) { drawn = -1; draw(); } };
                    im.onerror = () => console.warn('Robot frame failed to load:', path(n));
                    im.src = path(n);
                }
                if (idx < order.length) setTimeout(next, 30);
            }
            next();
        }

        const lines = {
            'HTML5': ['I build the skeleton 🦴', 'Semantic. Accessible. Clean.'],
            'CSS & Animations': ['Make it pretty, make it move ✨', 'Hover me again, I like it!'],
            'JavaScript': ['Where the magic happens ⚡', 'Click, scroll, wiggle – all JS.'],
            'Python': ['Slithering through the backend 🐍', 'Automate all the things!'],
            'MySQL': ['Joins? Easy. 🔗', 'Queries fast as lightning.'],
            'Django': ['Batteries included! 🔋', 'Full-stack, no stress.'],
            'Photoshop': ['Pixels are my playground 🎨', 'Designs that pop!'],
            'Bootstrap': ['Responsive on every screen 📱', 'Grid, grid, baby!']
        };
        const pick = a => a[Math.floor(Math.random() * a.length)];
        const decode = t => { const d = document.createElement('div'); d.innerHTML = t; return d.textContent; };

        function say(text, ms = 2200) {
            bubble.textContent = text;
            bubble.classList.add('show');
            clearTimeout(bubbleTimer);
            bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
        }

        function setActive(card) {
            if (card === active) return;
            active = card;
            cards.forEach(c => c.classList.toggle('active', c === card));
            const col = card ? card.dataset.color : '#4dd8ff';
            stage.style.setProperty('--sk-accent', col);
            if (card) label.textContent = decode(card.dataset.name);
        }

        function nearestCard(f) {
            let best = null, bd = 1e9;
            cards.forEach(c => { const d = Math.abs(+c.dataset.frame - f); if (d < bd) { bd = d; best = c; } });
            return bd <= 9 ? best : null;
        }

        let lastSaid = null;
        function onInput() { lastInput = performance.now(); idle = false; }

        // pointer X across the whole skills section sweeps the sequence
        section.addEventListener('pointermove', e => {
            if (e.pointerType === 'touch') return;
            onInput();
            const r = section.getBoundingClientRect();
            const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
            target = 1 + nx * 108;     // 1…109 covers every key pose
        }, { passive: true });

        cards.forEach(c => {
            const go = () => { onInput(); target = +c.dataset.frame; };
            c.addEventListener('pointerenter', go);
            c.addEventListener('click', () => { go(); poke(); });
        });

        function poke() {
            wrap.classList.remove('poke', 'breathe');
            void wrap.offsetWidth;
            wrap.classList.add('poke');
            const c = nearestCard(Math.round(cur)) || active;
            say(c ? pick(lines[c.dataset.name] || ['Hey there!']) : pick(['Hey! That tickles 😆', 'Boop! 🤖', 'Hi, I\'m the skills bot!']));
            setTimeout(() => { wrap.classList.remove('poke'); wrap.classList.add('breathe'); }, 650);
        }
        wrap.addEventListener('pointerdown', () => { onInput(); poke(); });

        // main loop – frames step toward the target so the robot visibly turns
        function tick(now) {
            requestAnimationFrame(tick);
            if (!inView) return;

            if (!idle && now - lastInput > 5000) { idle = true; say(HINT, 2600); }
            if (idle) {
                target += idleDir * 0.35;
                if (target > 109) { target = 109; idleDir = -1; }
                if (target < 1) { target = 1; idleDir = 1; }
            }

            const diff = target - cur;
            if (Math.abs(diff) > 0.01) {
                const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.max(0.35, Math.abs(diff) * 0.22));
                cur = clamp(cur + step, 1, TOTAL);
                draw_(Math.round(cur));
            }
        }
        function draw_(n) {
            const prev = cur; cur = n; draw(); cur = prev;
            const c = nearestCard(n);
            setActive(c);
            if (c && c !== lastSaid && Math.abs(target - n) < 3 && !idle) { lastSaid = c; say(pick(lines[c.dataset.name] || ['Hi!']), 1800); }
        }

        // cards slide in when the stage scrolls into view (both directions)
        new IntersectionObserver(es => es.forEach(e => {
            cards.forEach(c => c.classList.toggle('in', e.isIntersecting));
            inView = e.isIntersecting;
            if (e.isIntersecting) { onInput(); say(HELLO, 2400); }
        }), { threshold: 0.2 }).observe(stage);

        window.addEventListener('resize', fit, { passive: true });
        if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas);
        fit(); load(); requestAnimationFrame(tick);
    })();


    // ════════════════════════════════════════════════════════════════════
    //  07 · SERVICES — cursor spotlight (entrance handled by the scroll engine)
    // ════════════════════════════════════════════════════════════════════

    // ─── SERVICE CARDS: staggered reveal + cursor spotlight ───────────────────
    (function () {
        const cards = document.querySelectorAll('.svc-card');
        if (!cards.length) return;
        const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        // The entrance itself is scroll-scrubbed by the engine in section 04;
        // here we only drive the cursor spotlight.
        if (!fine) return;
        cards.forEach(card => {
            let raf = 0;
            card.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
            card.addEventListener('pointermove', (e) => {
                if (raf) return;
                raf = requestAnimationFrame(() => {
                    raf = 0;
                    const r = card.getBoundingClientRect();
                    card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
                    card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
                    card.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 10).toFixed(2) + 'deg');
                    card.style.setProperty('--rx', ((0.5 - (e.clientY - r.top) / r.height) * 8).toFixed(2) + 'deg');
                });
            });
        });
    })();


    // ════════════════════════════════════════════════════════════════════
    //  08 · EDUCATION — magnetic timeline + neon wave rail
    // ════════════════════════════════════════════════════════════════════

    // ─── MAGNETIC EDUCATION TIMELINE ───────────────────────────────────────
    (function () {
        const timeline = document.querySelector('#education .timeline');
        if (!timeline) return;

        const items = [...timeline.querySelectorAll('.tl-item')];
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let raf = null;
        let mouseX = -9999, mouseY = -9999;
        let lastPct = -1, needsReset = true, tlVisible = true;

        function updateTimeline() {
            raf = null;
            if (!tlVisible) return;

            // ── READ phase (no writes in between = no layout thrash) ──
            const rect = cachedRect(timeline);
            const mouseActive = mouseX > -9000;
            const doCards = !reduceMotion && (mouseActive || needsReset);
            let reads = null;
            if (doCards) {
                needsReset = mouseActive;
                reads = items.map(item => {
                    const card = item.querySelector('.tl-card');
                    const dot = item.querySelector('.tl-dot');
                    return {
                        item, card, dot,
                        cr: card ? card.getBoundingClientRect() : null,
                        dr: dot ? dot.getBoundingClientRect() : null
                    };
                });
            }

            // ── WRITE phase ──
            const viewportCenter = window.innerHeight * 0.52;
            const raw = ((viewportCenter - rect.top) / Math.max(rect.height, 1)) * 100;
            const pct = Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
            if (pct !== lastPct) {
                lastPct = pct;
                // (--timeline-progress is not read by any CSS rule; writing it
                // forced a style recalc of the whole timeline on every scroll frame)
            }
            if (!reads) return;

            const vhNow = window.innerHeight;
            reads.forEach(({ item, card, dot, cr, dr }) => {
                if (!card) return;
                // far outside the viewport: nothing visible to update, and the
                // next scroll frame refreshes it as soon as it comes near
                if (cr && (cr.bottom < -400 || cr.top > vhNow + 400)) return;
                const cx = cr.left + cr.width / 2;
                const cy = cr.top + cr.height / 2;
                const dx = mouseX - cx;
                const dy = mouseY - cy;
                const dist = Math.hypot(dx, dy);
                const radius = 330;

                let tx = 0, ty = 0, rx = 0, ry = 0;
                if (dist < radius) {
                    const force = Math.pow(1 - dist / radius, 2);
                    tx = (dx / radius) * 13 * force;
                    ty = (dy / radius) * 8 * force;
                    ry = (dx / radius) * 3.2 * force;
                    rx = -(dy / radius) * 2.2 * force;
                    card.style.setProperty('--glow-x', ((mouseX - cr.left) / cr.width * 100) + '%');
                    card.style.setProperty('--glow-y', ((mouseY - cr.top) / cr.height * 100) + '%');
                }

                card.style.setProperty('--card-x', tx.toFixed(2) + 'px');
                card.style.setProperty('--card-y', (item.classList.contains('is-activated') ? ty : 35 + ty).toFixed(2) + 'px');
                card.style.setProperty('--card-rx', rx.toFixed(2) + 'deg');
                card.style.setProperty('--card-ry', ry.toFixed(2) + 'deg');

                if (dot && dr) {
                    const dcx = dr.left + dr.width / 2;
                    const dcy = dr.top + dr.height / 2;
                    const ddx = mouseX - dcx;
                    const ddy = mouseY - dcy;
                    const dDist = Math.hypot(ddx, ddy);
                    const dRadius = 230;
                    if (dDist < dRadius) {
                        const magnetic = Math.pow(1 - dDist / dRadius, 2);
                        const mx = (ddx / dRadius) * 20 * magnetic;
                        const my = (ddy / dRadius) * 20 * magnetic;
                        const scale = 1 + magnetic * .45;
                        dot.style.transform = `translate(${mx.toFixed(2)}px, ${my.toFixed(2)}px) scale(${scale.toFixed(2)})`;
                    } else {
                        dot.style.transform = '';
                    }
                }
            });
        }

        function requestUpdate() {
            if (!raf) raf = requestAnimationFrame(updateTimeline);
        }

        timeline.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            requestUpdate();
        }, { passive: true });

        timeline.addEventListener('mouseleave', () => {
            mouseX = -9999;
            mouseY = -9999;
            items.forEach(item => {
                const dot = item.querySelector('.tl-dot');
                if (dot) dot.style.transform = '';
            });
            requestUpdate();
        }, { passive: true });

        onScrollHook(updateTimeline);
        window.addEventListener('resize', requestUpdate, { passive: true });
        new IntersectionObserver(es => {
            tlVisible = es[es.length - 1].isIntersecting;
            if (tlVisible) requestUpdate();
        }, { rootMargin: '300px 0px' }).observe(timeline);
        requestUpdate();
    })();

    // ─── NEON WAVE RAIL (education timeline) ─────────────────────────────
    // Builds a dashed neon serpentine through every timeline dot. Each dot
    // sits on the crossing point; the curve swings out to the side opposite
    // its card in the gaps. Those swing points are "magnetic": they stretch
    // toward the cursor with a spring, so the light rope bends to follow it.
    // The lit part grows with scroll and a glowing head rides its tip.
    (function () {
        const timeline = document.querySelector('#education .timeline');
        const svg = document.getElementById('tlRail');
        if (!timeline || !svg) return;

        const $ = id => document.getElementById(id);
        const track = $('tlTrack'), bright = $('tlBright'), glow = $('tlGlowPath');
        const reveal = $('tlRevealRect'), grad = $('tlGrad'), head = $('tlHead');
        const filters = [$('tlGlowBig'), $('tlGlowSm')];
        const items = [...timeline.querySelectorAll('.tl-item')];
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const mobile = window.matchMedia('(max-width: 768px)');

        let W = 0, H = 0, pts = [], dotYs = [], raf = null, dirty = true, railVisible = true, totalLen = -1, lutX = null, lutY = null, lastRevH = -1;
        const mouse = { x: -9999, y: -9999 };

        function build() {
            W = timeline.clientWidth;
            H = timeline.clientHeight;
            if (!W || !H) return;

            svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
            grad.setAttribute('y2', H);
            filters.forEach(f => { f.setAttribute('width', W + 400); f.setAttribute('height', H + 200); });

            const mob = mobile.matches;
            const cx = mob ? 20 : W / 2;            // mobile: rail runs down the left side
            const amp = mob ? 10 : Math.min(190, W * 0.17);
            const dots = items.map(it => it.offsetTop + 45);
            dotYs = dots;

            pts = [{ bx: cx, by: 0, ox: 0, oy: 0, fixed: true }];
            dots.forEach((y, i) => {
                pts.push({ bx: cx, by: y, ox: 0, oy: 0, fixed: true });
                const next = i < dots.length - 1 ? dots[i + 1] : H;
                const cardOnRight = mob ? (i % 2 === 0) : items[i].offsetLeft > W / 4;
                pts.push({
                    bx: cx + (cardOnRight ? -amp : amp),
                    by: (y + next) / 2,
                    ox: 0, oy: 0, fixed: false
                });
            });
            pts.push({ bx: cx, by: H, ox: 0, oy: 0, fixed: true });
            dirty = true;
        }

        function pathD() {
            const P = pts.map(p => ({ x: p.bx + p.ox, y: p.by + p.oy }));
            let d = `M${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
            for (let i = 0; i < P.length - 1; i++) {
                const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
                d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)},`
                    + `${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)},`
                    + `${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
            }
            return d;
        }

        function update() {
            raf = null;
            if (!pts.length || !railVisible) return;

            // Magnetic spring on the swing points
            const r = cachedRect(svg);
            const tr = cachedRect(timeline);   // all reads first
            const mx = mouse.x - r.left, my = mouse.y - r.top;
            let moving = false;
            pts.forEach(p => {
                if (p.fixed) return;
                let tx = 0, ty = 0;
                if (!reduce) {
                    const dx = mx - p.bx, dy = my - p.by, dist = Math.hypot(dx, dy), R = 320;
                    if (dist < R) {
                        const f = Math.pow(1 - dist / R, 2);
                        tx = dx * f * 0.9;
                        ty = Math.max(-30, Math.min(30, dy * f * 0.5));
                    }
                }
                const ex = tx - p.ox, ey = ty - p.oy;
                p.ox += ex * 0.14;
                p.oy += ey * 0.14;
                if (Math.abs(ex) > 0.05 || Math.abs(ey) > 0.05) { moving = true; dirty = true; }
            });

            if (dirty) {
                const d = pathD();
                track.setAttribute('d', d);
                bright.setAttribute('d', d);
                glow.setAttribute('d', d);
                const g2 = document.getElementById('tlGlowPath2'); if (g2) g2.setAttribute('d', d);
                dirty = false;
                totalLen = -1; lutX = null; lutY = null;
            }

            // Scroll progress: lit length + glowing head
            const pct = Math.max(0, Math.min(1, (window.innerHeight * 0.6 - tr.top) / Math.max(tr.height, 1)));
            const py = pct * H;
            const revH = Math.round((py + 100) * 2) / 2;
            if (revH !== lastRevH) { lastRevH = revH; reveal.setAttribute('height', revH); }

            // The card reveals exactly when the head reaches (connects to) its dot
            items.forEach((item, i) => {
                const on = py >= dotYs[i];
                if (on === item.classList.contains('is-activated')) return;
                item.classList.toggle('is-activated', on);
                const card = item.querySelector('.tl-card');
                if (card) card.style.setProperty('--card-y', on ? '0px' : '35px');
            });

            // PERFORMANCE: getPointAtLength is expensive (it walks the bezier path);
            // the old code called it ~15x per scroll frame. The path is sampled ONCE
            // into a lookup table (rebuilt only when the path itself changes), and
            // each frame just binary-searches that table in plain JS.
            if (!lutX) {
                const total = totalLen >= 0 ? totalLen : (totalLen = bright.getTotalLength());
                const N = 240;
                lutX = new Float32Array(N + 1); lutY = new Float32Array(N + 1);
                for (let i = 0; i <= N; i++) {
                    const q = bright.getPointAtLength(total * i / N);
                    lutX[i] = q.x; lutY[i] = q.y;
                }
            }
            let lo = 0, hi = lutY.length - 1;
            while (hi - lo > 1) {
                const m = (lo + hi) >> 1;
                if (lutY[m] < py) lo = m; else hi = m;
            }
            const dy = lutY[hi] - lutY[lo];
            const f = dy > 0.0001 ? Math.min(1, Math.max(0, (py - lutY[lo]) / dy)) : 1;
            const ptx = lutX[lo] + (lutX[hi] - lutX[lo]) * f;
            const pty = lutY[lo] + dy * f;
            head.setAttribute('transform', `translate(${ptx.toFixed(1)},${pty.toFixed(1)}) scale(${mobile.matches ? 0.62 : 1})`);

            if (moving) raf = requestAnimationFrame(update);
        }

        function request() { if (!raf) raf = requestAnimationFrame(update); }

        timeline.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; request(); }, { passive: true });
        timeline.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; request(); });
        onScrollHook(() => { if (raf) { cancelAnimationFrame(raf); raf = null; } update(); });
        new IntersectionObserver(es => {
            railVisible = es[es.length - 1].isIntersecting;
            if (railVisible) request();
        }, { rootMargin: '300px 0px' }).observe(timeline);
        onWidthResize(() => { build(); request(); });
        mobile.addEventListener('change', () => {
            items.forEach(it => it.classList.remove('is-activated'));
            build(); request();
        });
        if ('ResizeObserver' in window) { let ro = 0; new ResizeObserver(() => { if (ro) return; ro = requestAnimationFrame(() => { ro = 0; build(); request(); }); }).observe(timeline); }
        window.addEventListener('load', () => { build(); request(); });

        build();
        request();
    })();


    // ════════════════════════════════════════════════════════════════════
    //  09 · CONTACT — card + section reveal
    // ════════════════════════════════════════════════════════════════════

    // ─── CONTACT CARDS: MAGNETIC SCROLL TRIGGER (re-fires both ways) ───────
    // Same bidirectional behavior as the Skills cards above: cards snap
    // into place scrolling down AND scrolling back up, resetting to the
    // pulled-away state whenever they leave the viewport.
    (function () {
        const cards = Array.from(document.querySelectorAll('.contact-links-column-right .editorial-contact-card'));
        if (!cards.length) return;

        const timers = new WeakMap();

        const magneticContactEngine = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const card = entry.target;
                const existing = timers.get(card);
                if (existing) clearTimeout(existing);

                if (entry.isIntersecting) {
                    const cascadeDelay = parseFloat(card.dataset.delay || 0) * 1000;
                    const t = setTimeout(() => card.classList.add('visible'), cascadeDelay);
                    timers.set(card, t);
                } else {
                    card.classList.remove('visible');
                }
            });
        }, {
            root: null,
            rootMargin: '0px 0px -8% 0px',
            threshold: 0.15
        });

        cards.forEach(card => magneticContactEngine.observe(card));
    })();

    // ─── FULL CONTACT SECTION: SMOOTH SCROLL REVEAL (re-fires both ways) ───
    // Wraps the whole section — heading, copy, email box, and the card
    // grid — in one smooth fade/slide envelope that plays every time the
    // section scrolls into view, and reverses when it scrolls back out,
    // so moving up or down the page always feels like the same eased
    // motion rather than a one-time entrance.
    (function () {
        const contactInner = document.querySelector('#contact>.section-inner');
        if (!contactInner) return;

        const sectionRevealEngine = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                entry.target.classList.toggle('section-in-view', entry.isIntersecting);
            });
        }, {
            root: null,
            rootMargin: '0px 0px -10% 0px',
            threshold: 0.08
        });

        sectionRevealEngine.observe(contactInner);
    })();


})();