# Contributing

## Preliminaries

Bug fixes are highly encouraged!

For feature extensions to existing modules, it is generally recommended to start a discussion before you open a PR.

If you have a new module that you think could fit into this repository, please start by opening a GitHub issue to start a discussion, or reach out in the OpenJS slack.
Note that for a new module you will also be asked to asses what level of maintenance you will be able to provide over the longer term.

## Preparations

Most work is done on master.

## Review

Open Visualization team members will make efforts to review your PRs.
As always, clean and focused PRs that do one thing only will be approved and landed faster. Instead of including an unrelated one line fix, consider making a second small PR.

## Landing PRs

Once comments are addressed and the CI tests on GitHub run clean, your PR will be landed by an Open Visualization team member.  

## Closing PRs

PRs that do not receive updates to comments for one or two days will be closed, for "repository hygiene" reasons.

If this happens to you and you are coming back to address the PR, just reopen it once you have pushed your changed.

## Fixing CI issues

Unfortunately, many good PRs are closed. By far the most common reason is that the authors can't be bothered to make CI run clean. 

Note that CI can usually be fixed in 1-2 minutes as follows:

- `yarn lint fix` - will run `prettier` and `eslint --fix` and fixes 95% of failed CI checks.
- `yarn` - also make sure you run `yarn` to update `yarn.lock` after making changes depdencies in any `package.json` files. For security reasons, GitHub CI will reject your PR if your `yarn.lock` file is out of date with your `package.json` files.

After running these commands just commit and push your PR again and it will likely run green.

## Publishing new versions

Open Visualization team members will make efforts to publish new versions once your PRs land. A good cadence is a weekly patch with any accumulated fixes.

## Official contributors

If you regularly contribute to one of the modules, you may be granted write access to the deck.gl-community GitHub repository allowing you e.g. sto push branches directly instead of working via a GitHub fork.

This is decided by the Open Visualization Technical Steering committee and is based on trust, merit and scope of contributions.
