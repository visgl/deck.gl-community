import {relative} from 'node:path';
import {BaseSequencer, type TestSpecification} from 'vitest/node';

// Approximate seconds on the hosted software renderer (Actions runs 45452757851, 45453762991 and 45465550022).
// Include the long suites only. New files participate automatically.
const SUITE_SECONDS: Record<string, number> = {
  'examples/layers/flame-trail/scene.browser.spec.ts': 38,
  'examples/layers/seasonal-farm/app.browser.spec.ts': 31,
  'examples/playground/gallery.browser.spec.ts': 31,
  'modules/layers/test/common-layers/flame-trail-layer/flame-trail-layer.browser.spec.ts': 31,
  'modules/layers/test/extensions/selection-pulse-extension/selection-pulse-extension.browser.spec.ts': 31,
  'modules/layers/test/tree-layers/tree-layer/render-correctness.browser.spec.ts': 24,
  'modules/layers/test/tree-layers/tree-layer/tree-canopy-colors.browser.spec.ts': 44,
  'modules/layers/test/tree-layers/tree-layer/tree-contract.browser.spec.ts': 37,
  'modules/layers/test/tree-layers/tree-layer/tree-grove-performance.browser.spec.ts': 70,
  'modules/layers/test/tree-layers/tree-layer/tree-grove.browser.spec.ts': 32,
  'modules/layers/test/tree-layers/tree-layer/tree-lifecycle-standard.browser.spec.ts': 285,
  'modules/layers/test/tree-layers/tree-layer/tree-mixed-species.browser.spec.ts': 140,
  'modules/layers/test/tree-layers/tree-layer/tree-photoreal-crops.browser.spec.ts': 430,
  'modules/layers/test/tree-layers/tree-layer/tree-photoreal.browser.spec.ts': 320,
  'modules/layers/test/tree-layers/tree-layer/tree-shadows.browser.spec.ts': 95,
  'modules/layers/test/tree-layers/tree-layer/webgpu-layers.browser.spec.ts': 23,
  'modules/vega/test/map-to-stacks.browser.spec.ts': 14
};

export default class BrowserTestSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const {index, count} = this.ctx.config.shard!;
    const shards = Array.from({length: count}, () => ({seconds: 0, files: [] as TestSpecification[]}));
    const suites = files.map(file => {
      const path = relative(this.ctx.config.root, file.moduleId);
      return {file, path, seconds: SUITE_SECONDS[path] ?? 2};
    });
    suites.sort((a, b) => b.seconds - a.seconds || a.path.localeCompare(b.path));
    for (const suite of suites) {
      const shard = shards.reduce((a, b) => (a.seconds <= b.seconds ? a : b));
      shard.files.push(suite.file);
      shard.seconds += suite.seconds;
    }
    return shards[index - 1].files;
  }
}
