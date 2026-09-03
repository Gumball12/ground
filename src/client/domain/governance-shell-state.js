export const deriveGovernanceShellState = ({
  currentFilePath,
  error = null,
  requestedDocumentPath,
  snapshot,
} = {}) => {
  if (error) {
    return { accessState: null, phase: 'error' };
  }
  if (!currentFilePath
    || requestedDocumentPath !== currentFilePath
    || snapshot?.documentPath !== currentFilePath) {
    return { accessState: null, phase: 'loading' };
  }
  return { accessState: snapshot.state, phase: 'ready' };
};
