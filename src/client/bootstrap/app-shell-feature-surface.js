import { chatFeature } from '../application/app-shell/chat-feature.js';
import { commentsFeature } from '../application/app-shell/comments-feature.js';
import { exportFeature } from '../application/app-shell/export-feature.js';
import { gitFeature } from '../application/app-shell/git-feature.js';
import { lazyControllerFeature } from './lazy-controller-feature.js';
import { presenceFeature } from '../application/app-shell/presence-feature.js';
import { uiFeature } from '../application/app-shell/ui-feature.js';
import { workspaceFeature } from '../application/app-shell/workspace-feature.js';

export const appShellFeatures = Object.freeze({
  chat: chatFeature,
  comments: commentsFeature,
  export: exportFeature,
  git: gitFeature,
  lazyControllers: lazyControllerFeature,
  presence: presenceFeature,
  ui: uiFeature,
  workspace: workspaceFeature,
});

export function createAppShellFeatureSurface(appShell, features = appShellFeatures) {
  for (const feature of Object.values(features)) {
    for (const [name, method] of Object.entries(feature)) {
      if (!(name in appShell)) appShell[name] = method;
    }
  }
  return appShell;
}
