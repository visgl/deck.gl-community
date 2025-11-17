# WebGL Modules

The heart of `deck.gl-raster` is its WebGL modules. These building blocks give a
huge amount of customizability, at the cost of a learning curve and ease of
shooting yourself in the foot.

A series of modules defines a _pipeline_: a set of transformations that provide for what computations should be done on images in the GPU.

Note that it's easy to combine WebGL modules in such a way as to create an
_invalid pipeline_, where you get WebGL errors instead of a useful result. The
way to prevent these errors is to keep in mind the _input dimensions_ and
_output dimensions_ and ensure that the output dimensions of one stage match the
input dimensions of the next.

For example, you couldn't run `normalizedDifference` followed by
`pansharpenBrovey` because the former transforms 2 dimensions to 1 and the
latter takes 4 dimensions as input.

## Pipeline stages

The easiest way to think about the pipeline is in two stages, a "create image"
step and an "alter image" step. Every pipeline must have a "create image" step;
most will also have an "alter image" step.

### Create image

Load one or more images into an internal `image` object.

Use the modules provided in the [Create Image](../create-image) page to load one
or more images for transformations in the "Alter image" step.

### Alter image

A set of operations to be done on the internal `image` object. At the end of
this process, the `image` object will be rendered to the screen.

Explore the [Alter Image](../color) documentation to see available
transformations, or see the [Custom Modules](../custom-modules) page to write
your own.
