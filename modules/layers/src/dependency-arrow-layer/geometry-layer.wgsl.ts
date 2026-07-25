// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** WebGPU vertex and fragment shaders for dependency-arrow markers. */
export default /* wgsl */ `
struct GeometryLayerUniforms {
  sizeScale: f32,
  sizeUnits: i32,
  interpolationMode: i32,
  markerAnchor: i32,
};

@group(0) @binding(auto) var<uniform> geometryLayer: GeometryLayerUniforms;

struct GeometryLayerAttributes {
  @location(0) positions: vec2<f32>,
  @location(1) instanceSourcePositions: vec3<f32>,
  @location(2) instanceSourcePositions64Low: vec3<f32>,
  @location(3) instanceTargetPositions: vec3<f32>,
  @location(4) instanceTargetPositions64Low: vec3<f32>,
  @location(5) instanceRatios: f32,
  @location(6) instanceArcHeights: f32,
  @location(7) instanceArcTilts: f32,
  @location(8) instanceSizes: vec2<f32>,
  @location(9) instanceColors: vec4<f32>,
  @location(10) instancePickingColors: vec3<f32>,
};

struct GeometryLayerVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) markerPosition: vec2<f32>,
  @location(2) @interpolate(flat) pixelSize: vec2<f32>,
  @location(3) @interpolate(flat) pickingColor: vec3<f32>,
};

fn geometry_layer_paraboloid(
  distance: f32,
  sourceZ: f32,
  targetZ: f32,
  ratio: f32,
  arcHeight: f32
) -> f32 {
  let deltaZ = targetZ - sourceZ;
  let height = distance * arcHeight;
  if (height == 0.0) {
    return mix(sourceZ, targetZ, ratio);
  }
  let unitZ = deltaZ / height;
  let descending = deltaZ <= 0.0;
  let startZ = select(sourceZ, targetZ, descending);
  let arcRatio = select(ratio, 1.0 - ratio, descending);
  return sqrt(max(arcRatio * (unitZ * unitZ + 1.0 - arcRatio), 0.0)) * height + startZ;
}

fn geometry_layer_interpolate(
  source: vec3<f32>,
  target: vec3<f32>,
  ratio: f32,
  arcHeight: f32,
  arcTilt: f32
) -> vec3<f32> {
  if (geometryLayer.interpolationMode != 1) {
    return mix(source, target, ratio);
  }

  let distance = length(source.xy - target.xy);
  let height = geometry_layer_paraboloid(distance, source.z, target.z, ratio, arcHeight);
  let tiltAngle = radians(arcTilt);
  let delta = target.xy - source.xy;
  let direction = select(vec2<f32>(1.0, 0.0), normalize(delta), length(delta) > 0.0);
  let tilt = vec2<f32>(-direction.y, direction.x) * height * sin(tiltAngle);
  return vec3<f32>(mix(source.xy, target.xy, ratio) + tilt, height * cos(tiltAngle));
}

@vertex
fn vertexMain(attributes: GeometryLayerAttributes) -> GeometryLayerVaryings {
  geometry.worldPosition = attributes.instanceSourcePositions;
  geometry.worldPositionAlt = attributes.instanceTargetPositions;
  geometry.pickingColor = attributes.instancePickingColors;

  let source = project_position_vec3_f64(
    attributes.instanceSourcePositions,
    attributes.instanceSourcePositions64Low
  );
  let target = project_position_vec3_f64(
    attributes.instanceTargetPositions,
    attributes.instanceTargetPositions64Low
  );
  let current = geometry_layer_interpolate(
    source,
    target,
    attributes.instanceRatios,
    attributes.instanceArcHeights,
    attributes.instanceArcTilts
  );
  let adjacentRatio = select(
    attributes.instanceRatios - 0.01,
    attributes.instanceRatios + 0.01,
    attributes.instanceRatios < 0.01
  );
  let adjacent = geometry_layer_interpolate(
    source,
    target,
    adjacentRatio,
    attributes.instanceArcHeights,
    attributes.instanceArcTilts
  );
  let normal = select(current.xy - adjacent.xy, adjacent.xy - current.xy, attributes.instanceRatios < 0.01);
  let markerPosition = select(
    vec2<f32>((attributes.positions.x - 1.0) * 0.5, attributes.positions.y * 0.5),
    attributes.positions * 0.5,
    geometryLayer.markerAnchor == 1
  );
  let scaledSize = attributes.instanceSizes * geometryLayer.sizeScale;
  let unrotatedOffset = markerPosition * scaledSize;
  let angle = atan2(normal.y, normal.x);
  let cosine = cos(angle);
  let sine = sin(angle);
  let rotatedOffset = vec2<f32>(
    unrotatedOffset.x * cosine - unrotatedOffset.y * sine,
    unrotatedOffset.x * sine + unrotatedOffset.y * cosine
  );
  let offset = select(
    rotatedOffset,
    project_pixel_size_vec2(rotatedOffset),
    geometryLayer.sizeUnits == UNIT_PIXELS
  );
  geometry.position = vec4<f32>(current + vec3<f32>(offset, 0.0), 1.0);

  var varyings: GeometryLayerVaryings;
  varyings.position = project_common_position_to_clipspace(geometry.position);
  varyings.markerPosition = (attributes.positions + vec2<f32>(1.0)) * 0.5;
  varyings.pixelSize = select(
    project_size_vec2(scaledSize),
    scaledSize,
    geometryLayer.sizeUnits == UNIT_PIXELS
  );
  varyings.color = vec4<f32>(attributes.instanceColors.rgb, attributes.instanceColors.a * layer.opacity);
  varyings.pickingColor = attributes.instancePickingColors;
  return varyings;
}

@fragment
fn fragmentMain(varyings: GeometryLayerVaryings) -> @location(0) vec4<f32> {
  let width = max(varyings.pixelSize.x, 1.0);
  let profile = 1.0 - abs(1.0 - varyings.markerPosition.y * 2.0);
  let signedDistance = (profile - varyings.markerPosition.x) * width;
  let edgeRadius = fwidth(signedDistance);
  let mask = smoothstep(-edgeRadius, edgeRadius, signedDistance);
  if (mask == 0.0) {
    discard;
  }

  if (picking.isActive > 0.5) {
    if (!picking_isColorValid(varyings.pickingColor)) {
      discard;
    }
    return vec4<f32>(picking_normalizeColor(varyings.pickingColor), 1.0);
  }

  var fragColor = vec4<f32>(varyings.color.rgb, varyings.color.a * mask);
  if (picking.isHighlightActive > 0.5) {
    let highlightedColor = picking_normalizeColor(picking.highlightedObjectColor);
    let objectColor = picking_normalizeColor(varyings.pickingColor);
    if (picking_isColorZero(abs(objectColor - highlightedColor))) {
      let highlightAlpha = picking.highlightColor.a;
      let blendedAlpha = highlightAlpha + fragColor.a * (1.0 - highlightAlpha);
      if (blendedAlpha > 0.0) {
        fragColor = vec4<f32>(
          mix(fragColor.rgb, picking.highlightColor.rgb, highlightAlpha / blendedAlpha),
          blendedAlpha
        );
      }
    }
  }
  return deckgl_premultiplied_alpha(fragColor);
}
`;
