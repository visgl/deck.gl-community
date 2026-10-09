#!/bin/bash
set -e

node scripts/validate-token.js
npm run write-heading-ids

# staging or prod
MODE=$1
WEBSITE_DIR=`pwd`
OUTPUT_DIR=build

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

node scripts/normalize-llm-output.mjs
node scripts/check-llm-output.mjs

# transpile workers
(
  cd ..
  BABEL_ENV=es5 npx babel ./website/static/workers --out-dir ./website/$OUTPUT_DIR/workers
)
