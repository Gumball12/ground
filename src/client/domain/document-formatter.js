import { getVaultFileKind } from '../../domain/file-kind.js';

const FORMATTABLE_FILE_KINDS = new Set(['base', 'html', 'markdown', 'mermaid', 'plantuml']);
const PLANTUML_BLOCK_OPENERS = [
  [/^if\b.*\bthen\b/iu, 'endif'],
  [/^while\b/iu, 'endwhile'],
  [/^repeat\b(?!\s+while\b)/iu, 'repeat while'],
  [/^switch\b/iu, 'endswitch'],
  [/^fork\b(?!\s+again\b)/iu, 'end fork'],
  [/^split\b(?!\s+again\b)/iu, 'end split'],
  [/^(?:alt|opt|loop|par|critical|group|box|ref\s+over)\b/iu, 'end'],
  [/^break\s+\S/iu, 'end'],
];
const PLANTUML_MIDDLE_PATTERN = /^(?:else(?:if)?|and|fork\s+again|split\s+again|case|option)\b/iu;

function getPlantUmlOpaqueBlock(trimmedLine) {
  if (trimmedLine.startsWith("/'")) {
    return trimmedLine.slice(2).includes("'/")
      ? { oneLine: true }
      : { end: (line) => line.includes("'/") };
  }
  const tripleQuoteCount = trimmedLine.split('"""').length - 1;
  if (tripleQuoteCount % 2 === 1) return { end: (line) => line.includes('"""') };
  if (/^<style>.*<\/style>\s*$/iu.test(trimmedLine)) return { oneLine: true };
  if (/^<style>\s*$/iu.test(trimmedLine)) return { end: (line) => /<\/style>/iu.test(line) };
  if (/^!(?:if|ifdef|ifndef)\b/iu.test(trimmedLine)) {
    let depth = 1;
    return { end: (line) => {
      if (/^!(?:if|ifdef|ifndef)\b/iu.test(line)) depth += 1;
      if (/^!endif\b/iu.test(line)) depth -= 1;
      return depth === 0;
    } };
  }
  if (/^!(?:while|foreach)\b/iu.test(trimmedLine)) {
    const endPattern = /^!while\b/iu.test(trimmedLine) ? /^!endwhile\b/iu : /^!endfor\b/iu;
    return { end: (line) => endPattern.test(line) };
  }
  if (/^!(?:definelong|procedure|function)\b/iu.test(trimmedLine)) {
    return { end: (line) => /^!end(?:definelong|procedure|function)\b/iu.test(line) };
  }
  if (/^!\w+/u.test(trimmedLine)) return { oneLine: true };
  if (/^(?:[hr]?note|legend)\b(?!.*:\s*\S)/iu.test(trimmedLine)) {
    return { end: (line) => /^(?:end\s+note|endlegend)\b/iu.test(line) };
  }
  if (/^(?:title|header|footer|caption)\s*$/iu.test(trimmedLine)) {
    const blockName = trimmedLine.toLowerCase();
    return { end: (line) => line.toLowerCase().replace(/\s/gu, '') === `end${blockName}` };
  }
  if (/^(?:json|yaml|salt|sprite)\b.*\{\s*$/iu.test(trimmedLine)) {
    return { braceDepth: 1 };
  }
  return null;
}

function countPlantUmlBraces(line) {
  let count = 0;
  let escaped = false;
  let quoted = false;
  for (const character of line) {
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === '{') {
      count += 1;
    } else if (!quoted && character === '}') {
      count -= 1;
    }
  }
  return count;
}

function getPlantUmlCloser(trimmedLine) {
  if (/^\}\s*$/u.test(trimmedLine)) return '}';
  if (/^endif\b/iu.test(trimmedLine)) return 'endif';
  if (/^endwhile\b/iu.test(trimmedLine)) return 'endwhile';
  if (/^repeat\s+while\b/iu.test(trimmedLine)) return 'repeat while';
  if (/^endswitch\b/iu.test(trimmedLine)) return 'endswitch';
  if (/^end\s+fork\b/iu.test(trimmedLine)) return 'end fork';
  if (/^end\s+split\b/iu.test(trimmedLine)) return 'end split';
  if (/^end(?:\s+\w+)?\s*$/iu.test(trimmedLine)) return 'end';
  return null;
}

function getPlantUmlOpener(trimmedLine) {
  if (/\{\s*$/u.test(trimmedLine)) return '}';
  return PLANTUML_BLOCK_OPENERS.find(([pattern]) => pattern.test(trimmedLine))?.[1] ?? null;
}

function indentPlantUml(source) {
  const parts = String(source ?? '').split(/(\r\n|\n|\r)/u);
  const stack = [];
  let opaqueBlock = null;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const content = line.replace(/^[\t ]*/u, '');
    const trimmedLine = content.trimEnd();

    if (opaqueBlock) {
      if (opaqueBlock.braceDepth) {
        opaqueBlock.braceDepth += countPlantUmlBraces(trimmedLine);
        if (opaqueBlock.braceDepth <= 0) opaqueBlock = null;
      } else if (opaqueBlock.end(trimmedLine)) {
        opaqueBlock = null;
      }
      continue;
    }

    const nextOpaqueBlock = getPlantUmlOpaqueBlock(trimmedLine);
    if (nextOpaqueBlock) {
      opaqueBlock = nextOpaqueBlock.oneLine ? null : nextOpaqueBlock;
      continue;
    }
    if (!trimmedLine) continue;

    const closer = getPlantUmlCloser(trimmedLine);
    const closesCurrentBlock = closer && stack.at(-1) === closer;
    const isMiddle = PLANTUML_MIDDLE_PATTERN.test(trimmedLine) && stack.length > 0;
    const opener = getPlantUmlOpener(trimmedLine);

    if (stack.length > 0 || closesCurrentBlock || isMiddle || opener) {
      const depth = Math.max(0, stack.length - (closesCurrentBlock || isMiddle ? 1 : 0));
      parts[index] = `${'  '.repeat(depth)}${content}`;
    }
    if (closesCurrentBlock) stack.pop();
    if (opener) stack.push(opener);
  }

  return parts.join('');
}

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
  if (kind === 'plantuml') return indentPlantUml(source);
  if (kind === 'base') return formatWithPrettier(source, 'yaml');
  if (kind === 'html') return formatWithPrettier(source, 'html');
  if (kind === 'markdown') {
    const parser = String(filePath).toLowerCase().endsWith('.mdx') ? 'mdx' : 'markdown';
    return formatWithPrettier(source, parser);
  }
  return null;
}
