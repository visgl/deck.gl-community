export default {
  lint: {
    paths: ['docs', 'modules', 'examples', 'test'],
    extensions: ['js', 'jsx', 'ts', 'tsx']
  },

  babel: false,

  typescript: {
    project: 'tsconfig.build.json'
  },

  aliases: {
    test: './test'
  },

  browserTest: {
    server: {wait: 5000}
  },

  entry: {
    test: 'test/node.js',
    'test-browser': 'test/browser.js',
    bench: 'test/bench/node.js',
    'bench-browser': 'test/bench/browser.js',
    size: ['test/size/graph-layers.js']
  }
};
