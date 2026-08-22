import { expect, it } from 'vitest';

import '../../src/client/styles/base.css';
import '../../src/client/styles/style.css';

it('loads the bundled JetBrains Mono editor font', async () => {
  const font = Array.from(document.fonts).find(({ family }) => family === 'JetBrains Mono');

  expect(font).toBeDefined();
  await font.load();
  expect(font.status).toBe('loaded');
});
