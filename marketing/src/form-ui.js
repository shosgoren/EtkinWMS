// Shared marketing form behaviour. Draft values stay in the current DOM only.
window.EtkinFormUI = {
  mountPrivacy() {
    const overlay = document.querySelector('.demo-privacy');
    const card = overlay?.querySelector('[role="dialog"]');
    const root = document.getElementById('dc-root');
    if (!overlay || !card || !root) return;
    let opener = null;
    let scroll = 0;
    let overflow = '';
    const close = () => {
      overlay.hidden = true;
      root.inert = false;
      document.body.style.overflow = overflow;
      window.scrollTo(0, scroll);
      opener?.focus({ preventScroll: true });
    };
    document.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (overlay.contains(link) && link.getAttribute('href') === '/#demo') {
        event.preventDefault();
        history.back();
        return;
      }
      if (link.getAttribute('href') !== '/privacy' || !overlay.hidden) return;
      event.preventDefault();
      opener = link;
      scroll = window.scrollY;
      overflow = document.body.style.overflow;
      history.pushState({ demoPrivacy: true }, '', '/privacy');
      overlay.hidden = false;
      root.inert = true;
      document.body.style.overflow = 'hidden';
      card.focus();
    });
    window.addEventListener('popstate', () => {
      if (!overlay.hidden) close();
      else if (history.state?.demoPrivacy) {
        overlay.hidden = false;
        root.inert = true;
        document.body.style.overflow = 'hidden';
        card.focus();
      }
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); history.back(); }
      if (event.key !== 'Tab') return;
      const links = [...card.querySelectorAll('a[href],button,[tabindex="0"]')];
      const first = links[0], last = links.at(-1);
      if (!first) { event.preventDefault(); card.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
  },
};
