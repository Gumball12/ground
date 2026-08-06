const DOCX_EXPORTER_CREATOR = 'CollabMD';
let converterPromise = null;

function normalizeDocxBuffer(result) {
  if (Buffer.isBuffer(result)) {
    return result;
  }

  if (result instanceof ArrayBuffer) {
    return Buffer.from(result);
  }

  if (ArrayBuffer.isView(result)) {
    return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
  }

  throw new Error('DOCX exporter returned an unsupported payload');
}

async function ensureConverter() {
  if (!converterPromise) {
    converterPromise = import('@turbodocx/html-to-docx').then((module) => {
      const converter = module?.default ?? module?.HTMLToDOCX ?? module;
      if (typeof converter !== 'function') {
        throw new Error('DOCX converter failed to load');
      }
      return converter;
    });
  }

  return converterPromise;
}

export async function renderDocx({
  html,
  title = '',
} = {}) {
  const converter = await ensureConverter();
  const result = await converter(String(html ?? ''), null, {
    creator: DOCX_EXPORTER_CREATOR,
    font: 'Arial',
    footer: false,
    pageNumber: false,
    table: {
      row: {
        cantSplit: true,
      },
    },
    title: String(title ?? ''),
  });

  return normalizeDocxBuffer(result);
}
