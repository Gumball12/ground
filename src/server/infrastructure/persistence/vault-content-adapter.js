import {
  isBaseFilePath,
  isDrawioFilePath,
  isExcalidrawFilePath,
  isMarkdownFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';

const adapters = [
  {
    invalidPathError: 'Invalid file path',
    kind: 'markdown',
    matches: isMarkdownFilePath,
  },
  {
    invalidPathError: 'Invalid file path — must end in .base',
    kind: 'base',
    matches: isBaseFilePath,
  },
  {
    invalidPathError: 'Invalid file path — must end in .excalidraw',
    kind: 'excalidraw',
    matches: isExcalidrawFilePath,
  },
  {
    invalidPathError: 'Invalid file path — must end in .drawio',
    kind: 'drawio',
    matches: isDrawioFilePath,
  },
  {
    invalidPathError: 'Invalid file path — must end in .mmd or .mermaid',
    kind: 'mermaid',
    matches: isMermaidFilePath,
  },
  {
    invalidPathError: 'Invalid file path — must end in .puml or .plantuml',
    kind: 'plantuml',
    matches: isPlantUmlFilePath,
  },
];

export function getEditableVaultContentKind(filePath) {
  return adapters.find((adapter) => adapter.matches(filePath)) ?? null;
}
