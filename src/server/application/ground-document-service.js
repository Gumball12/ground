import { createGroundAccessOperations } from './ground-access-operations.js';
import { createGroundDocumentOperations } from './ground-document-operations.js';
import { createServiceHelpers } from './ground-service-support.js';

export const createGroundService = ({
  clock = () => new Date().toISOString(),
  createDocumentId,
  initialText = '',
  limits = {},
  manifest,
  store,
}) => {
  const helpers = createServiceHelpers({ clock, limits, manifest, store });

  return {
    ...createGroundAccessOperations({ createDocumentId, helpers, initialText }),
    ...createGroundDocumentOperations({ helpers }),
  };
};
