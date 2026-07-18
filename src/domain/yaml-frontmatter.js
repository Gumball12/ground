import { load as loadYaml } from 'js-yaml';

function getDocumentNewline(markdownText = '') {
  return String(markdownText).includes('\r\n') ? '\r\n' : '\n';
}

function normalizeLine(line = '') {
  return String(line).replace(/\r$/, '');
}

export function extractYamlFrontmatter(markdownText = '') {
  const normalizedMarkdown = String(markdownText ?? '');
  if (!normalizedMarkdown.startsWith('---')) {
    return null;
  }

  const newline = getDocumentNewline(normalizedMarkdown);
  const lines = normalizedMarkdown.split(/\r?\n/);
  if (normalizeLine(lines[0]) !== '---') {
    return null;
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (normalizeLine(lines[index]) === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return null;
  }

  const rawFrontmatter = lines.slice(0, closingIndex + 1).join(newline);
  const frontmatterSource = lines.slice(1, closingIndex).join(newline);

  let parsedData;
  try {
    parsedData = loadYaml(frontmatterSource || '{}');
  } catch {
    return null;
  }

  const lineCount = closingIndex + 1;
  const bodyMarkdown = [
    ...Array.from({ length: lineCount }, () => ''),
    ...lines.slice(closingIndex + 1),
  ].join(newline);

  return {
    bodyMarkdown,
    data: parsedData ?? {},
    endLine: lineCount,
    rawFrontmatter,
    startLine: 1,
  };
}
