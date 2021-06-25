const webpack = require('webpack');

const config = {
  mode: 'development',

  entry: {
    app: './app.js'
  },

  plugins: [new webpack.EnvironmentPlugin(['BingMapsAPIKey'])]
};

module.exports = env => (env && env.local ? require('../webpack.config.local')(config) : config);
