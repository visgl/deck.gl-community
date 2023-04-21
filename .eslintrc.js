// .eslintrc.js
import getESlintConfig from 'ocular-dev-tools/configuration';

const config = getESlintConfig({
  /** Set React version, if any */
  react: '18.0.0',
  /** This will be deep merged with the default config */
  overrides: {
    parserOptions: {
      project: ['./tsconfig.json']
    },
    rules: {
      // custom rules
    }
  },
  /** Print full config JSON for inspection */
  debug: true
});

export default config;