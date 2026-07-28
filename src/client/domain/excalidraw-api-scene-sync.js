function normalizeBinaryFileVersion(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeBinaryFileDataUrl(value) {
  return typeof value === 'string' ? value : '';
}

export function hasBinaryFilePayloadConflict(currentFile, nextFile) {
  return (
    normalizeBinaryFileVersion(currentFile?.version) !== normalizeBinaryFileVersion(nextFile?.version)
    || normalizeBinaryFileDataUrl(currentFile?.dataURL) !== normalizeBinaryFileDataUrl(nextFile?.dataURL)
  );
}

export function buildExcalidrawFileSyncPlan(currentFiles = {}, nextFiles = {}) {
  const missingFiles = [];
  const conflictingFileIds = [];

  Object.entries(nextFiles || {}).forEach(([fileId, nextFile]) => {
    const currentFile = currentFiles?.[fileId];
    if (!currentFile) {
      missingFiles.push(nextFile);
      return;
    }

    if (hasBinaryFilePayloadConflict(currentFile, nextFile)) {
      conflictingFileIds.push(fileId);
    }
  });

  return {
    conflictingFileIds,
    missingFiles,
    requiresFileReplacement: conflictingFileIds.length > 0,
  };
}

export function applySceneUpdateWithFiles(api, {
  captureUpdate,
  files = {},
  sceneUpdate,
} = {}, {
  onFileConflict = () => {},
} = {}) {
  const currentFiles = api?.getFiles?.() || {};
  const syncPlan = buildExcalidrawFileSyncPlan(currentFiles, files);

  if (syncPlan.requiresFileReplacement && typeof api?.replaceFiles !== 'function') {
    onFileConflict(syncPlan);
    return {
      ...syncPlan,
      applied: false,
      requiresRemount: true,
    };
  }

  if (syncPlan.requiresFileReplacement) {
    api.replaceFiles(Object.values(files));
  } else if (syncPlan.missingFiles.length > 0) {
    api.addFiles(syncPlan.missingFiles);
  }

  api.updateScene({
    ...sceneUpdate,
    captureUpdate,
  });

  return {
    ...syncPlan,
    applied: true,
    requiresRemount: false,
  };
}
