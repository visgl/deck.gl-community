module.exports = {
  lint: {
    paths: ['docs', 'modules', 'examples', 'test'],
    extensions: ['js']
  },

  aliases: {
    '@deck.gl/core': `${__dirname}/node_modules/@deck.gl/core`,
    '@deck.gl/layers': `${__dirname}/node_modules/@deck.gl/layers`,
    '@deck.gl/aggregation-layers': `${__dirname}/node_modules/@deck.gl/aggregation-layers`,
    '@deck.gl/geo-layers': `${__dirname}/node_modules/@deck.gl/geo-layers`,
    '@deck.gl/mesh-layers': `${__dirname}/node_modules/@deck.gl/mesh-layers`,
    '@deck.gl/extensions': `${__dirname}/node_modules/@deck.gl/extensions`,
    '@deck.gl/react': `${__dirname}/node_modules/@deck.gl/react`
  },

  browserTest: {
    server: {wait: 5000}
  },

  entry: {
    test: 'test/node.js',
    'test-browser': 'test/browser.js',
    bench: 'test/bench/node.js',
    'bench-browser': 'test/bench/browser.js',
    size: 'test/size/submodule.js'
  }
};
