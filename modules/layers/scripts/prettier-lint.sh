#!/bin/sh

# This script is only used in CI to verify that code is formatted with
# prettier. For local use, install the commit hook. See the README for details.

diffs=$(node_modules/.bin/prettier-eslint --write src/**/**/*.js website/**/**/*.js --eslint-config-path .eslintrc)
[ -z "$diffs" ] && exit 0

echo >&2 "Javascript files must be formatted with prettier."
echo >&2 "Please install the commmit hook locally:"
echo >&2 "./scripts/install-pre-commit.sh"
echo >&2 "Alternatively, you can manually format the code with this command:"
echo >&2 "node_modules/.bin/prettier-eslint --write "$diffs" --eslint-config-path .eslintrc.js"

exit 1
