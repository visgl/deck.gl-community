const {getESLintConfig} = require('ocular-dev-tools/configuration');

module.exports = getESLintConfig({
  /** Set React version, if any */
  react: '18.0.0',
  /** This will be deep merged with the default config */
  overrides: {
    parser: '',
    parserOptions: {
      project: ['./tsconfig.json'],
      ecmaVersion: 2020
    },
    extends: ['prettier'],
    env: {
      browser: true,
      node: true,
      jest: true,
      es2020: true
    },
    overrides: [
      {
        files: [
          'modules/*/src/**/*.{ts,tsx}',
          'modules/*/test/**/*.{ts,tsx}',
        ],
        rules: {
          // TODO: Gradually enable, at least for non-test code.
          '@typescript-eslint/no-unsafe-call': 0,
          '@typescript-eslint/no-unsafe-assignment': 0,
          '@typescript-eslint/no-unsafe-return': 0,
          '@typescript-eslint/no-unsafe-member-access': 0,
          '@typescript-eslint/explicit-module-boundary-types': 0
        }
      },
      {
        files: ['**/test/**/*.*', 'webpack.config.js', 'vite.config.js'],
        rules: {
          // devDependencies are installed workspace root.
          'import/no-extraneous-dependencies': 0,
          'import/no-unresolved': 0,
        }
      }
    ],
    rules: {
      // custom rules
    }
  },
  /** Print full config JSON for inspection */
  debug: false
});
