import { getVaultFileKind } from '../../domain/file-kind.js';

const FORMATTABLE_FILE_KINDS = new Set(['base', 'html', 'markdown', 'mermaid']);

export function canFormatDocument(filePath) {
  return FORMATTABLE_FILE_KINDS.has(getVaultFileKind(filePath));
}

async function formatWithPrettier(source, parser) {
  let pluginImport = import('prettier/plugins/markdown');
  if (parser === 'yaml') pluginImport = import('prettier/plugins/yaml');
  if (parser === 'html') pluginImport = import('prettier/plugins/html');

  const [{ format }, plugin] = await Promise.all([
    import('prettier/standalone'),
    pluginImport,
  ]);
  const plugins = [plugin.default];

  if (parser === 'mdx') {
    const [babel, estree] = await Promise.all([
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]);
    plugins.push(babel.default, estree.default);
  }

  return format(source, {
    parser,
    plugins,
    proseWrap: 'preserve',
  });
}

async function formatMermaid(source) {
  const [{ default: mermaid }, { formatMermaid }] = await Promise.all([
    import('mermaid'),
    import('mermaid-formatter'),
  ]);
  if (!await mermaid.parse(source, { suppressErrors: true })) {
    throw new Error('Mermaid syntax is invalid');
  }

  const formatted = formatMermaid(source, { indentSize: 2 });
  if (!await mermaid.parse(formatted, { suppressErrors: true })) {
    throw new Error('The formatter produced invalid Mermaid syntax');
  }
  return formatted;
}

export async function formatDocumentText(filePath, source) {
  const kind = getVaultFileKind(filePath);

  if (kind === 'mermaid') return formatMermaid(source);
  if (kind === 'base') return formatWithPrettier(source, 'yaml');
  if (kind === 'html') return formatWithPrettier(source, 'html');
  if (kind === 'markdown') {
    const parser = String(filePath).toLowerCase().endsWith('.mdx') ? 'mdx' : 'markdown';
    return formatWithPrettier(source, parser);
  }
  return null;
}
