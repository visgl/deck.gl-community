# deck.gl-raster

![gzipped size](https://img.badgesize.io/https://unpkg.com/@kylebarron/deck.gl-raster/dist/dist.min.js.svg?compression=gzip)
![NPM](https://img.shields.io/npm/l/@kylebarron/deck.gl-raster)

deck.gl layers and WebGL modules for client-side satellite imagery processing on the GPU.

[![](assets/images/msavi_grca_cfastie.jpg)][docs_website]

Landsat 8 [Modified Soil Adjusted Vegetation Index][msavi] over the Grand Canyon and Kaibab Plateau, with the [`cfastie` colormap][cfastie].

[msavi]: https://www.usgs.gov/land-resources/nli/landsat/landsat-modified-soil-adjusted-vegetation-index
[cfastie]: /colormaps

## Overview

[deck.gl](https://deck.gl) is a great WebGL-accelerated geospatial rendering
engine for the browser. deck.gl layers are designed to be composable and easy to
extend. As such, small variations of the pre-built layers can do amazing new
things, while not being fit for inclusion in the standard layer library.

This repository contains deck.gl layers and reusable WebGL modules for rendering
and computation on rasters, especially satellite imagery.

[Documentation Website][docs_website]

[docs_website]: https://kylebarron.dev/deck.gl-raster
