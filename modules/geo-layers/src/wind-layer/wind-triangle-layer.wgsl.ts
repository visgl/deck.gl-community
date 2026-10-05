// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Native WebGPU shaders for instanced wind and station-surface triangles. */
export default /* wgsl */ `
struct WindTriangleAttributes {
  @location(0) positions: vec2<f32>,
  @location(1) instanceFirstPositions: vec3<f32>,
  @location(2) instanceSecondPositions: vec3<f32>,
  @location(3) instanceThirdPositions: vec3<f32>,
  @location(4) instanceColors: vec4<f32>,
  @location(5) instancePickingColors: vec3<f32>,
};

struct WindTriangleVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) pickingColor: vec3<f32>,
};

@vertex
fn vertexMain(attributes: WindTriangleAttributes) -> WindTriangleVaryings {
  let position =
    attributes.instanceFirstPositions * (1.0 - attributes.positions.x - attributes.positions.y) +
    attributes.instanceSecondPositions * attributes.positions.x +
    attributes.instanceThirdPositions * attributes.positions.y;

  geometry.worldPosition = position;
  geometry.pickingColor = attributes.instancePickingColors;

  let projected = project_position_to_clipspace_and_commonspace(
    position,
    vec3<f32>(0.0),
    vec3<f32>(0.0)
  );
  geometry.position = projected.commonPosition;

  var varyings: WindTriangleVaryings;
  varyings.position = projected.clipPosition;
  varyings.color = vec4<f32>(
    attributes.instanceColors.rgb,
    attributes.instanceColors.a * layer.opacity
  );
  varyings.pickingColor = attributes.instancePickingColors;
  return varyings;
}

@fragment
fn fragmentMain(varyings: WindTriangleVaryings) -> @location(0) vec4<f32> {
  if (picking.isActive > 0.5) {
    if (!picking_isColorValid(varyings.pickingColor)) {
      discard;
    }
    return vec4<f32>(picking_normalizeColor(varyings.pickingColor), 1.0);
  }

  var fragColor = varyings.color;
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
