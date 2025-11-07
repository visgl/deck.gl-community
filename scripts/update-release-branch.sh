#!/bin/sh
# Example:
# update-release-branch.sh 9.2

set -e

BRANCH=`echo "$1-release"`
VERSION=`echo "$1.0"`
WEBSITE_PAGES=website/src/constants/defaults.js

echo "Updating branch to ${BRANCH}..."

# Replace source links in docs
find docs -iname "*.md" -type f -exec sed -i '' -E "s/deck.gl-community\/(tree|blob)\/master\/modules/deck.gl-community\/tree\/${BRANCH}\/modules/g" {} \;
find docs -iname "*.md" -type f -exec sed -i '' -E "s/deck.gl-community\/(tree|blob)\/master\/examples/deck.gl-community\/tree\/${BRANCH}\/examples/g" {} \;

# Replace source links in website
sed -i '' -E "s/deck.gl-community\/tree\/master/deck.gl-community\/tree\/${BRANCH}/g" "${WEBSITE_PAGES}"

# Bump dependencies in examples
update_dep() {
  FILE=$1
  VERSION=$2
  cat $FILE | jq ".dependencies |= . + \
  with_entries(select(.key | match(\"@deck.gl-community\")) | .value |= \"~${VERSION}\")" > temp
  mv temp $FILE
}

# https://stackoverflow.com/questions/4321456/find-exec-a-shell-function-in-linux
export -f update_dep
find examples/*/*/package.json -exec bash -c 'update_dep "$0" $1' {} $VERSION \;
