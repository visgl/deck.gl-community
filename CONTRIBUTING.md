## Contributing to <project>

**Thanks for taking the time to contribute!**

PRs and bug reports are welcome, and we are actively looking for new maintainers.

## Setting Up Dev Environment

The **master** branch is the active development branch.

Building <project> locally from the source requires Node.js `>=16`.
We use [yarn](https://yarnpkg.com/en/docs/install) to manage the dependencies. (currently yarn 1.x)

```bash
git checkout master
yarn bootstrap
yarn test
```

If you consider opening a PR, here are some documentations to get you started:

- vis.gl [developer process](https://www.github.com/visgl/tsc/tree/master/developer-process)

## Running examples locally

Start by setting up a development environment as described above. Once
installation and tests succeed:

1. Open `examples/bing-maps`, or another example
    ```bash
    cd examples/bing-maps
    ```
2. Install the example's dependencies
    ```bash
    yarn
    ```
3. Start the example, with dependencies linked from the workspace
    ```bash
    yarn start-local
    ```

The local webserver will start, and a link to the example will be displayed
in the terminal or opened in your browser. After most changes, examples will
reload automatically. After changes to dependencies, it may be necessary to
restart the demo with the `--force` flag: `yarn start-local --force`. See `package.json` in each example, and the [Vite documentation](https://vitejs.dev/), for more information.

## Community Governance

vis.gl is part of the [Urban Computing Foundation](https://uc.foundation/). See the organization's [Technical Charter](https://github.com/visgl/tsc/blob/master/Technical%20Charter.md).

### Technical Steering Committee

<project> development is governed by the vis.gl Technical Steering Committee (TSC).

### Maintainers

Maintainers of <project> have commit access to this GitHub repository, and take part in the decision making process.

If you are interested in becoming a maintainer, read the [governance guidelines](https://github.com/visgl/tsc/tree/master/developer-process/governance.md).

The vis.gl TSC meets monthly and publishes meeting notes via a [mailing list](https://lists.uc.foundation/g/visgl).
This mailing list can also be utilized to reach out to the TSC.

## Code of Conduct

Please be mindful of and adhere to the Linux Foundation's [Code of Conduct](https://lfprojects.org/policies/code-of-conduct/) when contributing to <project>.
