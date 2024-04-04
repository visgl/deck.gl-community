const {getESLintConfig} = require('ocular-dev-tools/configuration');

module.exports = getESLintConfig({
  /** Set React version, if any */
  react: '18.0.0',
  /** This will be deep merged with the default config */
  overrides: {
    env : {
      browser : true,
      node : true,
      jest: true,
      es6 : true
    },
    overrides: [
      {
        files: [
          "**/test/**/*.*", "webpack.config.js"
        ],
        rules: {
          "import/no-extraneous-dependencies": 0,
          "import/no-unresolved": 0,
          /** Disable 'any' after TypeScript migration. */
          "@typescript-eslint/no-unsafe-call": 0
        }
      }
    ],
    parserOptions: {
      babelOptions: {
        "presets": ["@babel/preset-react"]
      }
    },
    rules: {
      // custom rules
    }
  },
  /** Print full config JSON for inspection */
  debug: false
});
