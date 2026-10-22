# @deck.gl-community/extensions

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/extensions.svg)](https://www.npmjs.com/package/@deck.gl-community/extensions)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/extensions.svg)](https://www.npmjs.com/package/@deck.gl-community/extensions)

This module contains non-official deck.gl layer extensions.

They can be quite useful in applications, however they are not officially supported by the deck.gl team, so use at your own risk.

[`SelectionPulseExtension`](../../docs/modules/extensions/api-reference/selection-pulse-extension.md)
pulses the color of selected objects on the GPU. A selection change writes one value per object,
and each animation frame sets only uniforms.

[`ZoomOpacityExtension`](../../docs/modules/extensions/api-reference/zoom-opacity-extension.md)
makes a layer's opacity a function of the viewport zoom, like a MapLibre zoom expression on
`*-opacity`.

See the [module documentation](../../docs/modules/extensions/README.md).
