# Overview

![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

`graph-layers` is a deck.gl layer pack for GPU-powered visualization of large graphs. 

With graph-layers, developers can build various type of graph/network applications with minimum effort. 
The composable API enables highly customizable graph visualization by leveraging or even extending the provided graph *styles* and *layout algorithms*.

## History

`graph-layers` started out as a friendly fork of Uber's archived [graph.gl](https://graph.gl/gatsby/) framework, 
bringing the graph.gl code up-to-date with the latest deck.gl versions. 

## What's New

### `@deck.gl-community/graph-layers` v9.0.0 (In development)

Target Release date: April 2024

The graph-layers module has been repackaged as a deck.gl "layer pack" with additional features, and has been modernized in terms of: 
- upgraded to work with deck.gl v9 
- npm version number now aligned with deck.gl version.
- typescript codebase and APIs
- Now uses latest vis.gl build systems etc (ESM compatible).

### `deck-graph-layers` v0.0.1

Release date: April 14, 2023

An initial fork of Uber's [graph.gl](https://github.com/uber/graph.gl) repository. At the time of the fork, the repository has lacked maintainers for several years, the published versions were not compatible with recent deck.gl versions, and the repository no longer accepted external contributions.
