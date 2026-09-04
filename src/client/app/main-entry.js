import darkHighlightThemeUrl from '../assets/vendor/highlight/github-dark.min.css?url';
import lightHighlightThemeUrl from '../assets/vendor/highlight/github.min.css?url';
import '../styles/base.css';
import '../styles/style.css';

function ensureHighlightThemeStylesheet() {
  let themeStylesheet = document.getElementById('hljs-theme');
  if (!(themeStylesheet instanceof HTMLLinkElement)) {
    themeStylesheet = document.createElement('link');
    themeStylesheet.id = 'hljs-theme';
    themeStylesheet.rel = 'stylesheet';
    document.head.append(themeStylesheet);
  }

  themeStylesheet.href = darkHighlightThemeUrl;
  themeStylesheet.dataset.darkHref = darkHighlightThemeUrl;
  themeStylesheet.dataset.lightHref = lightHighlightThemeUrl;
}

ensureHighlightThemeStylesheet();

// `script-src 'self'` forbids an inline script, so the legacy hash handling the
// local shell reads runs here, before either bootstrap module loads.
if (window.location.hash.includes('file=')) {
  document.documentElement.setAttribute('data-initial-file-requested', 'true');
}

// `app-config.js` has already run, so the served runtime configuration decides
// which product this page is before either bootstrap module loads.
const runtimeConfig = window.__COLLABMD_CONFIG__;

if (runtimeConfig?.groundHosted && runtimeConfig.unavailable) {
  // A hosted deployment without runtime configuration can run neither product.
  // The copy lives here because this decision precedes every controller, and
  // booting the local shell would call a filesystem API that does not exist.
  const title = document.getElementById('groundUnavailableTitle');
  if (title) {
    title.textContent = 'This deployment is not configured';
  }
  const unavailable = document.getElementById('groundUnavailable');
  if (unavailable) {
    unavailable.hidden = false;
  }
} else if (runtimeConfig?.groundHosted) {
  await import('../ground-main.js');
} else {
  await import('../main.js');
}
