const config = {
  lint: {
    paths: ['docs', 'modules', 'examples', 'test'],
    extensions: ['js', 'jsx']
  },

  aliases: {
    '@deck.gl/core': './node_modules/@deck.gl/core',
    '@deck.gl/layers': './node_modules/@deck.gl/layers',
    '@deck.gl/aggregation-layers': './node_modules/@deck.gl/aggregation-layers',
    '@deck.gl/geo-layers': './node_modules/@deck.gl/geo-layers',
    '@deck.gl/mesh-layers': './node_modules/@deck.gl/mesh-layers',
    '@deck.gl/extensions': './node_modules/@deck.gl/extensions',
    '@deck.gl/react': './node_modules/@deck.gl/react',
    test: './test'
  },

  browserTest: {
    server: {wait: 5000}
  },

  entry: {
    test: 'test/node.cjs',
    'test-browser': 'test/browser.js',
    bench: 'test/bench/node.ts',
    'bench-browser': 'test/bench/browser.ts',
    size: 'test/size/submodule.ts'
  }
};

export default config;
