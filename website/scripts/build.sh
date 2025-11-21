#!/bin/bash
set -e

node scripts/validate-token.js
npm run write-heading-ids

# staging or prod
MODE=$1
WEBSITE_DIR=`pwd`
OUTPUT_DIR=build

# build gallery (scripting) examples
(
  cd ../examples/gallery
  yarn
  yarn build
)
rm -rf static/gallery
mkdir -p static/gallery
cp -r ../examples/gallery/dist/* static/gallery/

# clean up cache
docusaurus clear

case $MODE in
  "prod")
    docusaurus build
    ;;
  "staging")
    STAGING=true docusaurus build
    ;;
esac

# transpile workers
(
  cd ..
  BABEL_ENV=es5 npx babel ./website/static/workers --out-dir ./website/$OUTPUT_DIR/workers
)
