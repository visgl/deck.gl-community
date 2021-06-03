module.exports = {
  plugins: ['import'],
  extends: ['uber-es2015', 'prettier', 'plugin:import/errors'],
  overrides: [
    {
      files: ['*.spec.js', 'webpack.config.js'],
      rules: {
        'import/no-extraneous-dependencies': 0
      }
    }
  ],
  settings: {},
  rules: {
    'guard-for-in': 0,
    'no-inline-comments': 0,
    'import/no-unresolved': ['error', {ignore: ['test']}],
    'import/no-extraneous-dependencies': ['error', {devDependencies: false, peerDependencies: true}]
  },
  parserOptions: {
    ecmaVersion: 2018
  }
};
