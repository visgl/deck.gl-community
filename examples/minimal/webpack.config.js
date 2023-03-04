const HtmlWebpackPlugin = require('html-webpack-plugin');

const config = {
  mode: 'development',

  entry: {
    index: './index.js'
  },

  module: {
    rules: [
      {
        // Transpile ES6 to ES5 with babel
        // Remove if your app does not use JSX or you don't need to support old browsers
        test: /\.js$/,
        loader: 'babel-loader',
        exclude: [/node_modules/],
        options: {
          presets: ['@babel/preset-env', '@babel/preset-react']
        }
      }
    ]
  },

  plugins: [new HtmlWebpackPlugin({title: 'deck.gl example'})]
};

module.exports = (env) => (env && env.local ? require('../webpack.config.local')(config) : config);
