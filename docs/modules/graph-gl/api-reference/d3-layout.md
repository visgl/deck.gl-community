# D3 Force Layout

<p align="center">
  <img src="/gatsby/images/layouts/d3.png" height="400" />
</p>


This layout is an integration between [d3-force](https://github.com/d3/d3-force) and react-graph-gl to render the layout in a WebGL context.

## Configurations

You can set the custom configuration to the d3-force layout directed by passing a configuration object when instnatiating the layout object for GraphGL.

```js
<GraphGL
  {...otherProps}
  layout={
    new D3ForceLayout({
      nBodyStrength: 10,
      nBodyDistanceMin: 1,
      nBodyDistanceMax: 10,
    })
  }
/>
```

#### alpha (Number, optional)
The target alpha of the layout for each iteration. If alpha is specified, sets the current alpha to the specified number in the range [0,1]. The default value is 0.3.

#### resumeAlpha (Number, optional)
The resumeAlpha can be used to “reheat” the simulation during interaction, such as when dragging a node, or to resume the simulation after temporarily pausing the layout.
The default value is 0.1.

#### nBodyStrength: (Number, optional)
We use [many-body](https://github.com/d3/d3-force#many-body) as the charge force to apply force applies mutually amongst all nodes. It can be used to simulate gravity (attraction) if the `nBodyStrength` is positive, or electrostatic charge (repulsion) if the `nBodyStrength` is negative.
The default value is -900.

#### nBodyDistanceMin (Number, optional)
Sets the minimum distance between nodes over which this force is considered. If distance is not 'nBodyDistanceMin', returns the current minimum distance, which defaults to 100.


#### nBodyDistanceMax (Number, optional)
Sets the maximum distance between nodes over which this force is considered. If distance is not 'nBodyDistanceMin', returns the current minimum distance, which defaults to 400.

#### getCollisionRadius (Function, optional)
The [collision force](https://github.com/d3/d3-force#collision) treats nodes as circles with a given radius, rather than points, and prevents nodes from overlapping.  The `getCollisionRadius` expects a function as:
```js
getCollisionRadius: node => node.collisionRadius
```
The function will iterated each node and return the raidus for collision detection.
If getCollisionRadius is not specified, it defaults to zero radius for all nodes.

## Source

 - [d3-force.js](TBD/blob/master/src/layouts/d3-force/index.js)

 - [Storybook example](TBD/blob/master/stories/basic-layouts/stories.js#L56-L71)
