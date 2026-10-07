# SplatLayer

Prepared anisotropic 3D Gaussians, instanced by owning data rows. `SplatLayer` is a `CompositeLayer` built on deck.gl, luma.gl and math.gl, with WebGL2 and WebGPU shaders. It accepts decoded arrays and shares immutable template buffers per device; file decoding, training, streaming and spherical harmonics are outside this API.

```ts
import {SplatLayer, createSplatHierarchy, type SplatSource} from '@deck.gl-community/layers';

const source: SplatSource = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([0.3, 0.12, 0.02]),
  rotations: new Float32Array([1, 0, 0, 0]), // WXYZ
  colors: new Uint8Array([80, 160, 50, 255]),
  opacities: new Float32Array([0.85])
};

new SplatLayer({
  data: objects,
  source,
  getPosition: object => object.position,
  getScale: object => object.scale,
  getColor: [255, 255, 255, 255],
  pickable: true
});
```

## Source

Sources are immutable. Replace the source object when its arrays change. Positions and positive one-sigma scales contain XYZ triples. Rotations contain normalized WXYZ quaternions. Colors contain RGBA bytes or linear RGBA floats; float alpha and peak opacity must be in `[0, 1]`. Optional XYZ normals affect lighting, independently of covariance. Authored normals remain in the local foliage frame instead of flipping toward the camera at grazing angles. All arrays have the same Gaussian count. Invalid lengths, non-finite values, zero scales and non-unit quaternions fail before upload.

The source is local to each owner. `getPosition` uses the layer coordinate system. `getScale`, `getOrientation` (pitch/yaw/roll in degrees) and `getTranslation` transform the local template; translation follows scale and rotation and uses metres in geospatial views. Picking returns the source data object and original index, including after refinement and culling. Fragments below alpha `0.08` do not intercept picking.

## Properties

Inherits `CompositeLayer` properties. Accessors receive the original data object and accessor context. Use `updateTriggers` when an accessor's result changes without replacing data, following deck.gl conventions.

| Property | Default | Meaning |
| --- | --- | --- |
| `source` | Required | Prepared immutable Gaussian template. |
| `getPosition` | `d => d.position` | Owner position in the layer coordinate system. |
| `getOrientation` | `[0, 0, 0]` | Pitch, yaw and roll in degrees. |
| `getScale` | `[1, 1, 1]` | Local XYZ scale. |
| `getTranslation` | `[0, 0, 0]` | Translation after orientation and scale. |
| `getColor` | `[255, 255, 255, 255]` | Owner RGBA tint. Alpha multiplies template alpha and opacity once. |
| `material` | Ambient/diffuse | Phong material with supplied normals. |
| `kernelVariance` | `0.3` | Device-pixel variance added to projected covariance. Opacity is compensated by the covariance determinant ratio. |
| `support` | `3` | Gaussian support in standard deviations, between 1 and 6. |
| `alphaCutoff` | `1/255` | Minimum retained fragment contribution. |
| `hierarchy` | `null` | Finest source at error zero, followed by increasing finite local error bounds. |
| `pixelError` | `0.75` | Device-pixel bound used to select a spatial aggregate. |
| `getDeformation` | `[1, 0, 0]` | Bend height, stable phase and flex multiplier. |
| `deformationStrength` | `0` | Bend amplitude as a fraction of owner height. |
| `deformationTime` | `null` | Seconds; null uses the shared deck timeline. |
| `shadowEnabled` | `true` | Include this source in a host optical shadow pass. |

## Rendering and refinement

The shader transforms all three covariance axes and projects an oriented ellipse using the projection Jacobian. Pixel filtering broadens covariance and reduces peak alpha to conserve projected coverage. Wind combines a clamped cubic bending shape with a spatial crown mode. It transforms both the centre and covariance with the same analytic Jacobian used by the tree meshes; normals use the inverse transpose. This is a reduced animation field, not a structural dynamics solver.

A shared effect captures opaque depth, accumulates weighted Gaussian colors and logarithmic optical depth into two targets in one additive MRT geometry pass. It resolves premultiplied foliage in the ordinary draw pass, preserving mesh occlusion and downstream postprocessing. **Place opaque layers before Gaussian layers.** Weighted color blending is an order-independent approximation, not exact sorted alpha blending; layered colors can differ from a trained, depth-sorted splat renderer. Color accumulation requires renderable RGBA16F, and optical depth uses R16F. The extra opaque depth pass and Gaussian projection still cost more than opaque meshes for comparable geometry. The host light transmission pass uses RGBA8 and has quantization at very small contributions.

`createSplatHierarchy(source, increasingCellSizes)` builds spatial covariance aggregates once. Each level preserves weighted position, covariance, color and approximate orientation-averaged projected optical mass; its error bounds centre displacement, not every possible view-dependent silhouette. Coarse levels store nonnegative `opticalDepths`, so many opaque leaves do not collapse into a capped opacity and disappear. The original source remains available for close views. Adjacent levels crossfade in optical depth. Refinement mixtures advance once per draw and persist across camera and quota changes, with normalized easing and a bounded per-frame step, including when wind is off. Interrupted changes start from the current mixture. The perspective derivative is bounded off-axis and regularized where Gaussian support crosses the eye; near-plane coverage fades instead of cutting a large billboard abruptly. Owner transforms and a bounding-volume hierarchy are prepared once per data/accessor change. Camera updates traverse visible bounds and measure the perspective projection Jacobian at each surviving crown; they do not scan every owner or rebuild the spatial index. Multi-view visibility uses the union of viewport frusta, and light maps query the same spatial bounds with a separate refinement criterion. The hierarchy reduces far-field vertex work without a tree detail control. Mercator bounds use owner-local metre scales and survive changes to camera latitude. Frustum planes are extracted once per query. Unchanged owner lists retain their GPU attributes; changing LOD coverage updates only the coverage buffer. Changed membership uploads bounded contiguous ranges, avoiding excessive small driver writes. Finest sources with very many Gaussians still have substantial vertex and fill cost.

## Shadows

A Gaussian is translucent; an ordinary depth-only shadow map cannot represent its transmission. `SplatShadowPass` renders multiplicative light-space transmission from the same templates and wind pose. Supply a `SplatShadowProjection` with a common-space matrix, precision-preserving centre, width and height. Call each `SplatLayer.prepareShadow(projections, viewport)` before a shadow frame to select owners against the light volume rather than the camera. Selection is applied during the next layer update; schedule a redraw after a new light volume.

The pass accepts deck.gl layer-pass options and exposes `transmission`, a texture that a host combines with opaque shadow coverage. This API represents a planar receiver below all foliage. It does not provide volumetric self-shadowing or receiver-depth-dependent transmission on arbitrary terrain. A host must allocate bounded light maps and combine this transmission with opaque coverage. Ordinary `LightingEffect` still casts opaque tree wood and crop shadows, but needs this host integration to include translucent foliage. Optical shadow integration is WebGL-only; WebGPU foliage rendering and wind are supported.

See `TreeLayer` for procedural leaf templates, connected branches and seasons.

### Bounded refinement

`maxSplats` and `maxShadowSplats` default to `Infinity`, preserving the supplied screen-error selection. Finite budgets prioritize hierarchy refinements by projected error reduction per added Gaussian. The allocator reserves a quarter of a finite quota for optical transitions and favors retained detail within a 20% priority band. Promotions use the reserved overlap capacity. If every fade is blocked while its target fits, the smallest missing owner representation may temporarily exceed the quota until its old representation retires. Forced reductions use the same bounded overlap allowance. Optical coverage stays normalized throughout. Settled selections return to the allocated quota. Every visible owner remains present. A budget below the coarsest coverage floor cannot be honored without source/spatial aggregation. These limits count Gaussian submissions, not fragments, GPU bytes or hardware time.

`maxRenderPixels` (default `Infinity`) limits the shared accumulation target. The smallest limit among visible draw sources applies to the common pass. Its opaque occlusion capture uses the same target size, then the Gaussian result resolves at host resolution with linear sampling. Opaque drawing and picking retain host resolution. Lower target sizes soften foliage and reduce occlusion precision; this controls fragment work independently of Gaussian count.

`foveationStrength` defaults to zero. A positive value weights each owner's projected source center when selecting screen-error refinement and allocating submissions. At one, central weight is one and peripheral weight smoothly approaches 0.15. Frustum visibility and independent light-space shadow selection are unchanged. It is screen-center foveation, not eye tracking.

Prepared `SplatSource.opticalDepths` optionally overrides peak `opacities`: transmission is `exp(-opticalDepth * Gaussian * coverageWeight)`. Color alpha scales this density once. This avoids saturation loss in dense aggregates and needs no additional vertex attribute. Authored sources without optical depths retain peak-alpha Gaussian semantics. Covariance aggregation preserves approximate projected mass averaged over orientation; it does not exactly reproduce every view of anisotropic leaves.

A host can combine `SplatShadowPass` transmission with opaque mesh depth on a planar receiver. The source renderer is independent of any tree or example layer.
