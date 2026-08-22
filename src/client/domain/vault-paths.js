import {
  isBaseFilePath,
  isDrawioFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
  isStructurizrFilePath,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';

export function normalizeVaultPathInput(value) {
  const normalized = String(value ?? '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/')) {
    return '';
  }

  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return '';
  }

  return segments.join('/');
}

export function composeVaultChildPath(parentDir, childPath) {
  const normalizedParent = normalizeVaultPathInput(parentDir);
  const normalizedChild = normalizeVaultPathInput(childPath);

  if (!normalizedParent) {
    return normalizedChild;
  }

  if (!normalizedChild) {
    return normalizedParent;
  }

  return `${normalizedParent}/${normalizedChild}`;
}

export function getVaultPathLeaf(pathValue = '') {
  return String(pathValue ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

export function getVaultPathParent(pathValue = '') {
  const normalized = String(pathValue ?? '').replace(/\/+$/u, '');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : '';
}

export function ensureVaultExtension(pathValue, extension) {
  return pathValue.toLowerCase().endsWith(extension.toLowerCase())
    ? pathValue
    : `${pathValue}${extension}`;
}

export function createMarkdownStarter(filePath) {
  const title = stripVaultFileExtension(String(filePath ?? '').split('/').pop() || '') || 'Untitled';
  return `# ${title}\n\n`;
}

export function createBaseStarter(filePath) {
  const normalizedPath = normalizeVaultPathInput(filePath);
  const nextPath = isBaseFilePath(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}.base`;
  return {
    content: [
      'views:',
      '  - type: table',
      '    name: Table',
      '    order:',
      '      - file.name',
      '',
    ].join('\n'),
    path: nextPath,
  };
}

export function createMermaidStarter(filePath) {
  const normalizedPath = normalizeVaultPathInput(filePath);
  const nextPath = isMermaidFilePath(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}.mmd`;
  return {
    content: [
      'flowchart TD',
      '  A[Start] --> B{Decide}',
      '  B -->|Yes| C[Ship it]',
      '  B -->|No| D[Revise]',
      '',
    ].join('\n'),
    path: nextPath,
  };
}

export function createDrawioStarter(filePath) {
  const normalizedPath = normalizeVaultPathInput(filePath);
  const nextPath = isDrawioFilePath(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}.drawio`;
  return {
    content: [
      '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="CollabMD" version="24.7.17">',
      '  <diagram id="page-1" name="Page-1">',
      '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
      '      <root>',
      '        <mxCell id="0" />',
      '        <mxCell id="1" parent="0" />',
      '      </root>',
      '    </mxGraphModel>',
      '  </diagram>',
      '</mxfile>',
      '',
    ].join('\n'),
    path: nextPath,
  };
}

export function createPlantUmlStarter(filePath) {
  const normalizedPath = normalizeVaultPathInput(filePath);
  const nextPath = isPlantUmlFilePath(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}.puml`;
  return {
    content: [
      '@startuml',
      'Alice -> Bob: Hello',
      '@enduml',
      '',
    ].join('\n'),
    path: nextPath,
  };
}

export function createStructurizrStarter(filePath) {
  const normalizedPath = normalizeVaultPathInput(filePath);
  const nextPath = isStructurizrFilePath(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}.dsl`;
  return {
    content: [
      'workspace "CollabMD Example" "A small Structurizr workspace" {',
      '  model {',
      '    user = person "User" "Uses the system"',
      '    system = softwareSystem "Example System" "The system being documented" {',
      '      web = container "Web Application" "Serves the user interface" "JavaScript" {',
      '        home = component "Home Page" "Shows the landing page" "React"',
      '        editor = component "Editor" "Edits workspace content" "React"',
      '      }',
      '      api = container "API" "Handles requests" "Node.js"',
      '    }',
      '    user -> system "Uses"',
      '    web -> api "Calls" "HTTPS/JSON"',
      '    home -> editor "Links to"',
      '  }',
      '  views {',
      '    systemContext system "Context" {',
      '      include *',
      '      autoLayout',
      '    }',
      '    container system "Containers" {',
      '      include *',
      '      autoLayout',
      '    }',
      '    component web "Components" {',
      '      include *',
      '      autoLayout',
      '    }',
      '    styles {',
      '      element "Person" {',
      '        shape person',
      '      }',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
    path: nextPath,
  };
}
