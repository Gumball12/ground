import { describe, expect, it } from 'vitest';

import { GitDiffViewController } from '../../src/client/presentation/git-diff-view-controller.js';

describe('GitDiffViewController draw.io summaries', () => {
  it('parses XML cells without treating attribute content as markup', () => {
    const controller = new GitDiffViewController();
    const before = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1"/><mxCell id="shape-1" value="Before > After"/></root></mxGraphModel>';
    const after = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1"/><mxCell id="shape-1" value="Updated > After"/><mxCell id="shape-2" value="New"/></root></mxGraphModel>';
    const markup = controller.renderDrawioDiff({
      drawioAfterSource: after,
      drawioBeforeSource: before,
      fileKind: 'drawio',
      path: 'test.drawio',
      status: 'modified',
    });

    expect(markup).toContain('+1');
    expect(markup).toContain('~1');
  });
});
