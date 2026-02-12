## Contributing to deck.gl-community

**Thanks for taking the time to contribute!**

PRs and bug reports are welcome, and we are actively looking for new maintainers.

## Setting Up Dev Environment

The **master** branch is the active development branch.

Building deck.gl-community locally from the source requires Node.js `>=20`.
We use [yarn](https://yarnpkg.com/en/docs/install) to manage the dependencies, and Node [corepack](https://github.com/nodejs/corepack) to manage the yarn version.

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

vis.gl is part of the [OpenJS Foundation](https://openjsf.org/). See the organization's [Technical Charter](https://github.com/visgl/tsc/blob/master/CHARTER.md).

### Technical Steering Committee

deck.gl-community development is governed by the vis.gl Technical Steering Committee (TSC). See the TSC's [current members](https://github.com/visgl/tsc/tree/master?tab=readme-ov-file#technical-steering-committee).

### Maintainers

- [Charles Richardson](https://github.com/charlieforward9) - editable-layers
- [Ib Green](https://github.com/ibgreen) - infovis-layers, graph-layers

Maintainers of deck.gl-community have commit access to this GitHub repository, and take part in the decision making process.

If you are interested in becoming a maintainer, read the [governance guidelines](https://github.com/visgl/tsc/blob/master/GOVERNANCE.md).

The vis.gl TSC meets bi-weekly at the Open Visualization Biweekly Meeting via [zoom](https://zoom-lfx.platform.linuxfoundation.org/meetings/ojsf?view=month).
The [OpenJS Slack](https://slack-invite.openjsf.org/) can also be utilized to reach out to the TSC in the `#deckgl-community` channel.

## Code of Conduct

Please be mindful of and adhere to the OpenJS Foundation's [Code of Conduct](https://github.com/openjs-foundation/cross-project-council/blob/main/CODE_OF_CONDUCT.md) when contributing to deck.gl-community.
