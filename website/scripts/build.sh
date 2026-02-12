#!/bin/bash
set -e

node scripts/validate-token.js
npm run write-heading-ids

# staging or prod
MODE=$1
WEBSITE_DIR=`pwd`
OUTPUT_DIR=build

# include gallery (scripting) examples
GALLERY_SOURCE=../examples/gallery
GALLERY_STATIC=static/gallery

rm -rf $GALLERY_STATIC
mkdir -p $GALLERY_STATIC
cp -r $GALLERY_SOURCE/* $GALLERY_STATIC/

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
