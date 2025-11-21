const {cp, mkdir} = require('fs/promises');
const path = require('path');

// Ensures files in `examples/gallery` are available under `/gallery` in dev and
// production builds. The gallery content is authored outside of the website
// workspace, so we copy it into the generated output instead of duplicating
// sources.
module.exports = function galleryStaticPlugin(context, options = {}) {
  const {siteDir} = context;
  const sourceDir = options.sourceDir ?? path.resolve(siteDir, '..', 'examples', 'gallery');
  const routeBase = options.routeBase ?? '/gallery';

  return {
    name: 'gallery-static-plugin',

    getPathsToWatch() {
      return [sourceDir];
    },

    configureWebpack() {
      return {
        devServer: {
          static: [
            {
              directory: sourceDir,
              publicPath: routeBase
            }
          ]
        }
      };
    },

    async postBuild({outDir}) {
      const galleryOutput = path.join(outDir, routeBase.replace(/^\//, ''));
      await mkdir(galleryOutput, {recursive: true});
      await cp(sourceDir, galleryOutput, {recursive: true});
    }
  };
};
