# Get Started

## Installing

```sh
$ yarn add @deck.gl/core
$ yarn add @deck.gl/basemap-layers
```

## Using in deck.gl

To use the `BaseMapLayer` in your deck application

```js
import {Deck} from '@deck.gl/core';
import {BaseMapLayer} from '@deck,gl/basemap-layers';


new Deck({
  ...,
  layers: new BaseMapLayer({
    data: ..., 
    style: ...
  })
});
```

## Cloning the Repo

```sh
git clone https://github.com/UnfoldedInc/basemap-layers
cd basemap-layers
```

## Running Examples

```sh
cd examples/image
EE_CLIENT_ID=<your-client-id-goes-here>.apps.googleusercontent.com yarn start
```

## Contributing

### Building and Testing Code

```sh
git clone https://github.com/UnfoldedInc/BaseMap-layers
cd BaseMap-layers
yarn bootstrap
```

```sh
yarn lint
yarn lint fix # Autoformats code
yarn test
```

## Building the Website

To build the website locally (for instance if you are making contributions)

```sh
cd website
yarn
yarn develop
```

To build the website for production

```sh
cd website
export EE_CLIENT_ID=...
export GoogleMapsAPIKey=...
yarn build
yarn deploy
```
