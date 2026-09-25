import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

const ALIASES = [
  {find: 'crypto', replacement: 'node:crypto'}, // ensure Vite/Vitest get Node's crypto
  {
    find: /^@deck\.gl-community\/playground$/,
    replacement: fileURLToPath(new URL('./modules/playground/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/three',
    replacement: fileURLToPath(new URL('./modules/three/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/basemap-layers/style-spec',
    replacement: fileURLToPath(
      new URL('./modules/basemap-layers/src/style-spec.ts', import.meta.url)
    )
  },
  {
    find: '@deck.gl-community/basemap-layers',
    replacement: fileURLToPath(new URL('./modules/basemap-layers/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/react',
    replacement: fileURLToPath(new URL('./modules/react/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/panels',
    replacement: fileURLToPath(new URL('./modules/panels/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/widgets',
    replacement: fileURLToPath(new URL('./modules/widgets/src/index.ts', import.meta.url))
  },
  {
    find: /^@deck\.gl-community\/infovis-layers$/,
    replacement: fileURLToPath(new URL('./modules/infovis-layers/src/index.ts', import.meta.url))
  },
  {
    find: /^@deck\.gl-community\/layers$/,
    replacement: fileURLToPath(new URL('./modules/layers/src/index.ts', import.meta.url))
  },
  {
    find: /^@deck\.gl-community\/timeline-layers$/,
    replacement: fileURLToPath(new URL('./modules/timeline-layers/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/basemaps/style-spec',
    replacement: fileURLToPath(
      new URL('./modules/basemap-layers/src/style-spec.ts', import.meta.url)
    )
  },
  {
    find: '@deck.gl-community/basemaps',
    replacement: fileURLToPath(new URL('./modules/basemap-layers/src/index.ts', import.meta.url))
  },
  {
    find: /^monaco-editor$/,
    replacement: fileURLToPath(
      new URL('./node_modules/monaco-editor/esm/vs/editor/editor.main.js', import.meta.url)
    )
  }
];

const NODE_RESOLVE_CONFIG = {
  alias: ALIASES,
  dedupe: ['react', 'react-dom'],
  conditions: ['node'] // prefer node resolution
};

const BROWSER_RESOLVE_CONFIG = {
  alias: ALIASES,
  dedupe: ['react', 'react-dom']
};

const BROWSER_OPTIMIZE_DEPS_CONFIG = {
  include: ['@deck.gl/mesh-layers', '@loaders.gl/arrow', 'apache-arrow', 'three', 'zod']
};

const BROWSER_TEST_EXCLUDE = ['modules/**/dist/**', 'dev/**/dist/**'];

const REQUIRE_WEBGPU = process.env.DECK_GL_COMMUNITY_SOFTWARE_WEBGPU === 'true';
const HEADLESS_BROWSER_PROVIDER = REQUIRE_WEBGPU
  ? playwright({
      launchOptions: {
        channel: 'chrome',
        args: [
          '--enable-unsafe-webgpu',
          '--enable-unsafe-swiftshader',
          '--use-angle=swiftshader',
          '--use-webgpu-adapter=swiftshader',
          // Linux CI has no Vulkan display surface; use Chromium's SwiftShader presentation path.
          ...(process.platform === 'linux'
            ? ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface']
            : [])
        ]
      }
    })
  : process.env.GITHUB_ACTIONS === 'true'
    ? playwright({launchOptions: {channel: 'chrome'}})
    : playwright();

const CONFIG = defineConfig({
  resolve: NODE_RESOLVE_CONFIG,
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['modules/*/src/**/*.{ts,tsx,js,jsx}', 'dev/*/src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['modules/template/**', 'modules/*/src/**/*.d.ts', 'dev/*/src/**/*.d.ts']
    },
    projects: [
      {
        resolve: NODE_RESOLVE_CONFIG,
        test: {
          name: 'node',
          environment: 'node',
          include: ['modules/**/*.{test,spec}.{js,ts}', 'dev/**/*.{test,spec}.{js,ts}'],
          exclude: [
            'modules/**/dist/**',
            'dev/**/dist/**',
            'modules/**/*.browser.{test,spec}.{js,ts}',
            'dev/**/*.browser.{test,spec}.{js,ts}',
            'modules/widgets/src/widget-panels/toolbar-widget.test.ts',
            'modules/basemap-layers/**'
          ],
          browser: {
            enabled: false
          }
        }
      },
      {
        resolve: BROWSER_RESOLVE_CONFIG,
        optimizeDeps: BROWSER_OPTIMIZE_DEPS_CONFIG,
        plugins: [react()],
        test: {
          name: 'browser',
          provide: {requireWebGPU: false},
          environment: 'node',
          include: [
            'modules/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'examples/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'modules/panels/test/imports.spec.ts',
            'modules/**/*.{test,spec}.{jsx,tsx}',
            'dev/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'dev/**/*.{test,spec}.{jsx,tsx}'
          ],
          exclude: BROWSER_TEST_EXCLUDE,
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{browser: 'chromium'}]
          }
        }
      },
      {
        resolve: BROWSER_RESOLVE_CONFIG,
        optimizeDeps: BROWSER_OPTIMIZE_DEPS_CONFIG,
        plugins: [react()],
        test: {
          name: 'headless',
          // GPU contexts share one software renderer in CI; concurrent suites starve each other.
          fileParallelism: !(REQUIRE_WEBGPU || process.env.GITHUB_ACTIONS === 'true'),
          // SwiftShader's cold WGSL compilation is much slower than native GPU compilation.
          ...(REQUIRE_WEBGPU && {testTimeout: 60000}),
          provide: {requireWebGPU: REQUIRE_WEBGPU},
          environment: 'node',
          include: [
            'modules/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'examples/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'modules/panels/test/imports.spec.ts',
            'modules/**/*.{test,spec}.{jsx,tsx}',
            'dev/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'dev/**/*.{test,spec}.{jsx,tsx}'
          ],
          exclude: BROWSER_TEST_EXCLUDE,
          browser: {
            enabled: true,
            headless: true,
            provider: HEADLESS_BROWSER_PROVIDER,
            instances: [{browser: 'chromium'}]
          }
        }
      },
      {
        resolve: BROWSER_RESOLVE_CONFIG,
        plugins: [react()],
        test: {
          name: 'examples',
          environment: 'node',
          include: ['examples/**/*.{test,spec}.{js,ts,jsx,tsx}'],
          exclude: ['examples/**/*.browser.{test,spec}.{js,ts,jsx,tsx}']
        }
      }
    ]
    // You can omit top-level include if everyone is scoped in their projects
  }
});

export default CONFIG;
