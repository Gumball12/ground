/* CollabMD landing — interactions */
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Nav scrolled state ---------- */
  const nav = document.querySelector('.nav');
  const menuToggle = document.querySelector('.nav-menu-toggle');
  const navLinks = Array.from(document.querySelectorAll('.nav-links a'));
  const navSections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const setMenuOpen = (open) => {
    nav.classList.toggle('is-menu-open', open);
    menuToggle?.setAttribute('aria-expanded', String(open));
    menuToggle?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  const updateActiveNav = () => {
    const marker = window.scrollY + Math.min(window.innerHeight * 0.28, 220);
    let activeId = '';
    for (const section of navSections) {
      if (section.offsetTop <= marker) activeId = section.id;
    }
    navLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${activeId}`;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  const onScroll = () => {
    nav.classList.toggle('is-scrolled', window.scrollY > 24);
    updateActiveNav();
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateActiveNav);
  menuToggle?.addEventListener('click', () => setMenuOpen(!nav.classList.contains('is-menu-open')));
  navLinks.forEach((link) => link.addEventListener('click', () => setMenuOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('is-menu-open')) {
      setMenuOpen(false);
      menuToggle?.focus();
    }
  });

  /* ---------- Scroll reveals ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    document.documentElement.classList.add('reveal-ready');
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- Terminal typing (the hero signature) ---------- */
  const cmdEl = document.getElementById('term-cmd');
  const outEl = document.getElementById('term-out');
  const caretEl = document.getElementById('term-caret');
  const nextEl = document.getElementById('term-next');
  const COMMAND = 'npx collabmd@latest ~/my-vault --no-tunnel';

  const openSession = () => {
    outEl.classList.add('is-open');
    outEl.setAttribute('aria-hidden', 'false');
    // Drop to a fresh prompt line, like a real terminal.
    if (caretEl) caretEl.style.display = 'none';
    if (nextEl) {
      nextEl.classList.add('is-open');
      nextEl.setAttribute('aria-hidden', 'false');
    }
  };

  if (cmdEl && outEl) {
    if (reducedMotion) {
      cmdEl.textContent = COMMAND;
      openSession();
    } else {
      document.documentElement.classList.add('terminal-ready');
      cmdEl.textContent = '';
      outEl.setAttribute('aria-hidden', 'true');
      nextEl?.setAttribute('aria-hidden', 'true');
      let i = 0;
      const typeNext = () => {
        if (i <= COMMAND.length) {
          cmdEl.textContent = COMMAND.slice(0, i);
          i += 1;
          // Slight human-ish jitter, faster through the boring middle.
          const ch = COMMAND[i - 1];
          const base = ch === ' ' ? 130 : 34 + Math.random() * 46;
          setTimeout(typeNext, base);
        } else {
          setTimeout(openSession, 420);
        }
      };
      // Wait until the terminal has revealed itself before typing.
      const termEl = cmdEl.closest('.term');
      if (termEl && 'IntersectionObserver' in window) {
        const tio = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              tio.disconnect();
              setTimeout(typeNext, 350);
            }
          },
          { threshold: 0.4 },
        );
        tio.observe(termEl);
      } else {
        typeNext();
      }
    }
  }

  /* ---------- Copy buttons ---------- */
  const copyButtons = document.querySelectorAll('.copy-btn');
  const flashLabel = (btn, text) => {
    const label = btn.querySelector('.copy-label');
    if (!label) return;
    const original = label.dataset.original || label.textContent;
    label.dataset.original = original;
    label.textContent = text;
    btn.classList.add('is-copied');
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => {
      label.textContent = original;
      btn.classList.remove('is-copied');
    }, 1600);
  };

  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(text);
        flashLabel(btn, 'Copied');
      } catch {
        // Fallback for non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        try {
          const copied = document.execCommand('copy');
          flashLabel(btn, copied ? 'Copied' : 'Copy failed');
        } catch {
          flashLabel(btn, 'Copy failed');
        }
        ta.remove();
      }
    });
  });
  document.documentElement.classList.add('copy-ready');

  /* ---------- Install tabs ---------- */
  const tabs = Array.from(document.querySelectorAll('.install-tab'));
  const panels = Array.from(document.querySelectorAll('.install-panel'));

  const activateTab = (tab, focus = true) => {
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
    });
    panels.forEach((p) => {
      const active = p.id === tab.getAttribute('aria-controls');
      p.classList.toggle('is-active', active);
      p.hidden = !active;
    });
    if (focus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab, false));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        activateTab(next);
      }
    });
  });
  if (tabs.length && panels.length) document.documentElement.classList.add('tabs-ready');

})();
