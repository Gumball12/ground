import { createGroundAccessOperations } from './ground-access-operations.js';
import { createGroundDocumentOperations } from './ground-document-operations.js';
import { createServiceHelpers } from './ground-service-support.js';

export const createGroundService = ({
  clock = () => new Date().toISOString(),
  createDocumentId,
  initialText = '',
  limits = {},
  manifest,
  rateLimitHmacKey,
  rateLimits,
  store,
}) => {
  const helpers = createServiceHelpers({
    clock,
    limits,
    manifest,
    rateLimitHmacKey,
    rateLimits,
    store,
  });

  return {
    ...createGroundAccessOperations({ createDocumentId, helpers, initialText }),
    ...createGroundDocumentOperations({ helpers }),
    // A server-side collaborator, deliberately camelCase so it can never
    // collide with the snake_case client operation union.
    enforceRateLimit: helpers.enforceRateLimit,
  };
};
