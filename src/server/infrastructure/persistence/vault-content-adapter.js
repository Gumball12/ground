import { getVaultFileKind } from '../../../domain/file-kind.js';

const INVALID_PATH_ERRORS = {
  base: 'Invalid file path — must end in .base',
  drawio: 'Invalid file path — must end in .drawio',
  excalidraw: 'Invalid file path — must end in .excalidraw',
  markdown: 'Invalid file path',
  mermaid: 'Invalid file path — must end in .mmd or .mermaid',
  plantuml: 'Invalid file path — must end in .puml or .plantuml',
};

export function getEditableVaultContentKind(filePath) {
  const kind = getVaultFileKind(filePath);
  return INVALID_PATH_ERRORS[kind]
    ? { invalidPathError: INVALID_PATH_ERRORS[kind], kind }
    : null;
}
