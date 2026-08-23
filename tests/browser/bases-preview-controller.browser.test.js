import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import { BasesPreviewController } from '../../src/client/presentation/bases-preview-controller.js';

function createResult() {
  return {
    columns: [{ id: 'note.value', label: 'Value' }],
    groups: [],
    rows: [],
    summaries: [],
    totalRows: 0,
    meta: {
      activeViewConfig: {
        filters: {
          and: [
            'note.value == "first"',
            {
              or: [
                'note.value == "second"',
                'note.value == "third"',
              ],
            },
          ],
        },
        groupBy: null,
        order: ['note.value'],
        sort: [
          { direction: 'asc', property: 'note.value' },
          { direction: 'asc', property: 'note.value' },
        ],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
    view: { id: 'view-0', name: 'Table', supported: true, type: 'table' },
    views: [{ id: 'view-0', name: 'Table', supported: true, type: 'table' }],
  };
}

describe('BasesPreviewController accessible filter controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gives repeated and nested filter controls distinct computed names', async () => {
    document.body.innerHTML = '<div id="base"></div>';
    const placeholder = document.getElementById('base');
    const controller = new BasesPreviewController({
      vaultApiClient: { queryBase: async () => ({ result: createResult() }) },
    });
    const entry = {
      key: 'accessible-filter-controls',
      payload: { path: 'tasks.base', search: '', sourcePath: 'tasks.base', view: '' },
      placeholder,
      requestVersion: 0,
      ui: { filterMode: 'builder', openPanel: 'filter', propertySearch: '', rawFilterText: '' },
    };

    await controller.renderEntry(entry);

    await expect.element(page.getByRole('combobox', { name: 'Filter 1 property' })).toBeInTheDocument();
    await expect.element(page.getByRole('combobox', { name: 'Filter 2.1 operator' })).toBeInTheDocument();
    await expect.element(page.getByRole('textbox', { name: 'Filter 2.2 value' })).toBeInTheDocument();
    await expect.element(page.getByRole('combobox', { name: 'Filter group 2 condition' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Delete filter 2.1' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Delete filter group 2' })).toBeInTheDocument();
  });

  it('gives delete buttons distinct computed names across multiple sort rows', async () => {
    document.body.innerHTML = '<div id="base"></div>';
    const placeholder = document.getElementById('base');
    const controller = new BasesPreviewController({
      vaultApiClient: { queryBase: async () => ({ result: createResult() }) },
    });

    await controller.renderEntry({
      key: 'accessible-sort-controls',
      payload: { path: 'tasks.base', search: '', sourcePath: 'tasks.base', view: '' },
      placeholder,
      requestVersion: 0,
      ui: { filterMode: 'builder', openPanel: 'sort', propertySearch: '', rawFilterText: '' },
    });

    await expect.element(page.getByRole('button', { name: 'Delete sort rule 1' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Delete sort rule 2' })).toBeInTheDocument();
  });
});
