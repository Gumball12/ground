export function commitButtonLabel(count) {
  return count > 0
    ? `Commit ${count} file${count === 1 ? '' : 's'}`
    : 'Commit included files';
}
