import { isMarkdownFilePath } from '../../../domain/file-kind.js';

function assertWriteSucceeded(result, operation, filePath) {
  if (!result || result.ok !== false) {
    return;
  }

  throw new Error(`Failed to ${operation} for "${filePath}": ${result.error || 'Unknown error'}`);
}

export class CollaborationDocumentStore {
  constructor({
    backlinkIndex = null,
    name,
    vaultFileStore = null,
  }) {
    this.name = name;
    this.vaultFileStore = vaultFileStore;
    this.backlinkIndex = backlinkIndex;
  }

  hasPersistence() {
    return Boolean(this.vaultFileStore);
  }

  rename(nextName) {
    if (!nextName || nextName === this.name) {
      return;
    }

    this.name = nextName;
  }

  async readSnapshot() {
    return this.vaultFileStore?.readCollaborationSnapshot?.(this.name) ?? null;
  }

  async readContent() {
    return this.vaultFileStore?.readEditableVaultContent(this.name) ?? null;
  }

  async readCommentThreads() {
    return this.vaultFileStore?.readCommentThreads?.(this.name) ?? [];
  }

  async persistState({
    commentThreads = [],
    content = '',
    includeContent = true,
    snapshot = null,
  } = {}) {
    if (!this.vaultFileStore) {
      return;
    }

    const result = await this.vaultFileStore.persistCollaborationState(this.name, {
      commentThreads,
      content,
      includeContent,
      snapshot,
    });
    assertWriteSucceeded(result, 'persist collaboration state', this.name);

    if (includeContent && this.backlinkIndex && isMarkdownFilePath(this.name)) {
      this.backlinkIndex.updateFile(this.name, content);
    }
  }

  async writeSnapshot(snapshot) {
    if (!snapshot || !this.vaultFileStore?.writeCollaborationSnapshot) {
      return;
    }

    const result = await this.vaultFileStore.writeCollaborationSnapshot(this.name, snapshot);
    assertWriteSucceeded(result, 'write collaboration snapshot', this.name);
  }

}
