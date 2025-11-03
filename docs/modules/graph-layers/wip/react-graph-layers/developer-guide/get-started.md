# graph-layers

<p align="center">
  <img src="https://i.imgur.com/BF9aOEu.png" height="400" />
</p>

## Abstract
graph-layers is a React component for visualizing large graphs with several utility functions. It can build a highly customizable graph visualization through its composable API. The rendering is powered by deck.gl which is a WebGL based visualization framework.  With graph-layers, users are enabled to build various type of graph/network applications with minimum efforts while having the capability to extend the existing styles and layouts.

## Motivation
Uber originally started this project as Graph.gl. After stopping efforts on Graph.gl, the OpenJS Foundation has resumed efforts.

With graph-layers, developers are allowed to create graph visualization with minimum efforts while having the capability to override anything they want in the library.

## Roadmap

TBD, we've just started a reboot to update dependencies and modernize the codebase to reflect current React best practices.

## Get Started
```js
import GraphGL, {JSONLoader, D3ForceLayout} from 'deck-graph-layers';

const App = ({data}) => {
  const graph = JSONLoader({
    json: data,
    nodeParser: node => ({id: node.id}),
    edgeParser: edge => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      directed: true,
    }),
  });
  return (
    <GraphGL
      graph={graph}
      layout={new D3ForceLayout()}
      nodeStyle={[
        {
          type: 'circle',
          radius: 10,
          fill: 'blue',
          opacity: 1,
        },
      ]}
      edgeStyle={{
        stroke: 'black',
        strokeWidth: 2,
      }}
      enableDragging
    />
  );
}
````


## Setup Dev Environment

#### Clone the repo:

```
git clone git@github.com:deck.gl-community/graph-layers.git
```

#### Install yarn

```
brew update
brew install yarn
```

#### Install dependencies

```
yarn install
```

#### Local Development

You can write a story and open it in the docusaurus (using yarn 1.x):
```
cd website
yarn
yarn start
```

#### Testing

```
yarn test
```

To get coverage information, use:

```
yarn cover
```

#### Documentation

You can add your documentation (markdown) in `docs/` folder and the new chapter in `docs/table-of-contents.json`.
Open the local website:
```
cd website
yarn
yarn start
```

#### Contributing

PRs and bug reports are welcome. Note that you once your PR is
about to be merged, you will be asked to register as a contributor
by filling in a short form.
