const docusaurusPreset = require('@docusaurus/core/lib/babel/preset').default;
const typescriptPreset = require.resolve('@babel/preset-typescript');

/** Enable declare fields in Docusaurus' TypeScript preset for source-linked workspace modules. */
function docusaurusPresetWithDeclareFields(api) {
  const config = docusaurusPreset(api);

  return {
    ...config,
    presets: config.presets.map(preset =>
      preset === typescriptPreset ? [preset, {allowDeclareFields: true}] : preset
    )
  };
}

module.exports = {
  presets: [docusaurusPresetWithDeclareFields],
  plugins: [
    // 'version-inline',
    'inline-webgl-constants',
    [
      'remove-glsl-comments',
      {
        patterns: ['**/*.glsl.js', '**/*.glsl.ts']
      }
    ]
  ]
};
