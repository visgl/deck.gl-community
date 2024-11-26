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
        files: ['modules/*/src/**/*.{ts,tsx}', 'modules/*/test/**/*.{ts,tsx}'],
        rules: {
          // We definitely don't want to enable these rules
          ' no-use-before-define': 0,
          // TODO: Gradually enable, at least for non-test code.
          '@typescript-eslint/no-redundant-type-constituents': 0,
          'import/no-extraneous-dependencies': 0,
          'import/no-named-as-default': ['warn'],
          'import/named': ['warn'],
          '@typescript-eslint/no-unsafe-argument': 0,
          '@typescript-eslint/no-explicit-any': 0,
          '@typescript-eslint/ban-types': 0,
          '@typescript-eslint/no-unsafe-call': 0,
          '@typescript-eslint/no-unsafe-assignment': 0,
          '@typescript-eslint/no-unsafe-return': 0,
          '@typescript-eslint/no-unsafe-member-access': 0,
          '@typescript-eslint/explicit-module-boundary-types': 0,
          '@typescript-eslint/no-unused-vars': [
            'warn',
            {
              args: 'none'
            }
          ],
          '@typescript-eslint/no-empty-function': 0
        }
      },
      {
        files: ['**/test/**/*.*', 'webpack.config.js', 'vite.config.js'],
        rules: {
          // devDependencies are installed workspace root.
          'import/no-extraneous-dependencies': 0,
          'import/no-unresolved': 0,
          '@typescript-eslint/no-unsafe-member-access': 0,
          '@typescript-eslint/explicit-module-boundary-types': 0,
          '@typescript-eslint/no-unused-vars': [
            'warn',
            {
              args: 'none'
            }
          ],
          '@typescript-eslint/no-empty-function': 0
        }
      },
      {
        files: ['modules/**/*widget*.tsx', 'modules/**/widgets/**/*'],
        rules: {
          // For widgets. Disable React-style JSX linting since they conflict with Preact JSX.
          'react/react-in-jsx-scope': 0
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
