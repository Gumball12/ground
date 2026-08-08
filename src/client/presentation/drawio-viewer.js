const DRAWIO_VIEWER_SCRIPT_URL = 'https://viewer.diagrams.net/js/viewer-static.min.js';

let drawioViewerLoadPromise = null;

export function ensureDrawioViewerLoaded() {
  if (window.GraphViewer?.processElements) {
    return Promise.resolve(window.GraphViewer);
  }

  if (drawioViewerLoadPromise) {
    return drawioViewerLoadPromise;
  }

  drawioViewerLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-collabmd-drawio-viewer]');
    const script = existingScript instanceof HTMLScriptElement
      ? existingScript
      : document.createElement('script');

    const cleanup = () => {
      script.removeEventListener('error', handleError);
      script.removeEventListener('load', handleLoad);
    };

    const handleError = () => {
      cleanup();
      drawioViewerLoadPromise = null;
      reject(new Error('Failed to load draw.io viewer'));
    };

    const handleLoad = () => {
      cleanup();
      if (!window.GraphViewer?.processElements) {
        drawioViewerLoadPromise = null;
        reject(new Error('draw.io viewer did not initialize'));
        return;
      }

      resolve(window.GraphViewer);
    };

    script.addEventListener('error', handleError, { once: true });
    script.addEventListener('load', handleLoad, { once: true });

    if (!existingScript) {
      script.src = DRAWIO_VIEWER_SCRIPT_URL;
      script.async = true;
      script.dataset.collabmdDrawioViewer = 'true';
      document.head.append(script);
    } else if (window.GraphViewer?.processElements) {
      handleLoad();
    }
  });

  return drawioViewerLoadPromise;
}

export function createDrawioViewerElement({
  ariaLabel = '',
  className = 'drawio-viewer-frame',
  onActivate = null,
  source = '',
  theme = 'dark',
} = {}) {
  const graphElement = document.createElement('div');
  graphElement.className = className;
  if (ariaLabel) {
    graphElement.setAttribute('aria-label', ariaLabel);
  }

  if (typeof onActivate === 'function') {
    graphElement.dataset.action = 'open-file';
    graphElement.setAttribute('role', 'button');
    graphElement.setAttribute('tabindex', '0');
    graphElement.addEventListener('click', (event) => {
      event.preventDefault();
      onActivate();
    });
    graphElement.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      onActivate();
    });
  }

  graphElement.dataset.mxgraph = JSON.stringify({
    'check-visible-state': false,
    center: true,
    border: 0,
    'dark-mode': theme === 'light' ? 'light' : 'dark',
    editable: false,
    fit: 1,
    lightbox: false,
    nav: false,
    resize: false,
    tooltips: false,
    xml: String(source ?? ''),
  });

  return graphElement;
}

export async function renderDrawioViewer(host, options = {}) {
  const viewer = await ensureDrawioViewerLoaded();
  const graphElement = createDrawioViewerElement(options);
  host.replaceChildren(graphElement);

  if (typeof viewer.createViewerForElement === 'function') {
    viewer.createViewerForElement(graphElement);
  } else {
    viewer.processElements();
  }

  return graphElement;
}
