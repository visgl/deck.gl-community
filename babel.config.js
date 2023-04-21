// babel.config.js
import getBabelConfig from 'ocular-dev-tools/configuration';

const config = getBabelConfig({
  /** Enable React preset */
  react: true,
  /** This will be deep merged with the default config */
  overrides: {
    plugins: [
      // custom plugins
    ]
  },
  /** Print full config JSON for inspection */
  debug: true
});

export default config;