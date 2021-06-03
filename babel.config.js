/* eslint-disable import/no-extraneous-dependencies */
const getBabelConfig = require('ocular-dev-tools/config/babel.config');

module.exports = api => {
  const config = getBabelConfig(api);
  return config;
};
