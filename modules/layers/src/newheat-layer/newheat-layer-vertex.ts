// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const FLAME_VERTEX_DECLARATIONS = /* glsl */ `
in vec4 flameSlices;
out vec3 vFlame;
out float vFlameWeight;
out vec2 vEmberUV;

float newheat_vertexHash(float n) {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// TerrainExtension's GPU height map is in common space. Sample each slice's
// footprint, rather than anchoring the entire flame width at the path center.
float newheat_terrainHeight(vec3 foot) {
#ifdef NEWHEAT_TERRAIN
  if (terrain.mode == TERRAIN_MODE_USE_HEIGHT_MAP) {
    vec2 uv = (foot.xy - terrain.bounds.xy) / terrain.bounds.zw;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      return texture(terrain_map, uv).r;
    }
  }
#endif
  return 0.0;
}
`;

export const FLAME_VERTEX = /* glsl */ `
  vEmberUV = vec2(0.0);
  if (flameSlices.z > 1.5) {
    float duration = instanceNextTimestamps - instanceTimestamps;
    float interval = max(4.0, duration / 8.0);
    float emissionTime = (floor(instanceTimestamps / interval) + 1.0 + flameSlices.x) * interval;
    float anchorSeed = newheat_vertexHash(emissionTime * 0.73);
    float period = 28.0 + anchorSeed * 35.0;
    float elapsed = trips.currentTime - emissionTime - anchorSeed * 13.0;
    float cycle = floor(max(elapsed, 0.0) / period);
    float seed = newheat_vertexHash(emissionTime * 1.37 + cycle * 9.21);
    float lifetime = 10.0 + seed * 11.0;
    float progress = mod(max(elapsed, 0.0), period) / lifetime;
    bool emberActive = instanceTypes < 3.5 && duration > 0.0001
      && emissionTime <= instanceNextTimestamps && elapsed >= 0.0
      && progress < 1.0 && seed > 0.5;
    vTime = emissionTime;
    vPathPosition = vec2(0.0, 0.5);
    vPathLength = 1.0;
    vFlame = vec3(progress, seed, 2.0);
    vFlameWeight = emberActive ? 1.0 : 0.0;
    if (!emberActive) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float fraction = clamp((emissionTime - instanceTimestamps) / max(duration, 0.0001), 0.0, 1.0);
    vec3 emberBase = project_position(
      mix(instanceStartPositions, instanceEndPositions, fraction),
      mix(instanceStartPositions64Low, instanceEndPositions64Low, fraction)
    );
    emberBase.z += newheat_terrainHeight(emberBase);
    vec3 emberUp = vec3(0.0, 0.0, 1.0);
    mat3 emberRotation;
    if (project_needs_rotation(emberBase, emberRotation)) emberUp = emberRotation * emberUp;
    vec3 direction = project_position(instanceEndPositions, instanceEndPositions64Low)
      - project_position(instanceStartPositions, instanceStartPositions64Low);
    vec3 side = cross(direction, emberUp);
    side = length(side) > 0.00001 ? normalize(side) : vec3(1.0, 0.0, 0.0);
    float size = project_pixel_size(widthPixels.x) * 2.0;
    // Brief, buoyant flecks: a small curl near the plume, then rapid cooling.
    // Each burst has a new seed and a quiet interval, avoiding looping columns.
    float phase = seed * 6.28;
    float drift = sin(progress * 4.0 + phase) - sin(phase);
    float rise = progress * (1.25 + seed * 0.5) * (1.0 - progress * 0.2);
    vec3 emberPosition = emberBase + emberUp * size * (0.9 + seed * 0.3 + rise)
      + side * size * (drift * 0.12 + (seed - 0.65) * progress * 0.4);
    gl_Position = project_common_position_to_clipspace(vec4(emberPosition, 1.0));
    vEmberUV = vec2(positions.x * 2.0 - 1.0, positions.y);
    vec2 sparkSize = vec2(0.65 + seed * 0.35, 0.9 + seed * 0.6) * (1.0 - progress * 0.45);
    gl_Position.xy += project_pixel_size_to_clipspace(vEmberUV * sparkSize) * gl_Position.w;
    return;
  }
  vec3 flameBase = project_position(
    mix(instanceStartPositions, instanceEndPositions, positions.x),
    mix(instanceStartPositions64Low, instanceEndPositions64Low, positions.x)
  );
  vec3 flameUp = vec3(0.0, 0.0, 1.0);
  mat3 flameRotation;
  if (project_needs_rotation(flameBase, flameRotation)) {
    flameUp = flameRotation * flameUp;
  }
  float flameHalfWidth = project_pixel_size(widthPixels.x);
  vec3 tangent = project_position(instanceEndPositions, instanceEndPositions64Low)
    - project_position(instanceStartPositions, instanceStartPositions64Low);
  vec3 sideNormal = cross(tangent, flameUp);
  sideNormal = length(sideNormal) > 0.00001 ? normalize(sideNormal) : flameUp;
  vec3 flameNormal = flameUp;
  // The upstream clip position has a center-line offset, but geometry is passed
  // to that hook by value. Its common-space position is still the raw footprint.
  // Re-project it with terrain sampled across the full flame width.
#ifdef NEWHEAT_TERRAIN
  if (!path.billboard && terrain.mode == TERRAIN_MODE_USE_HEIGHT_MAP) {
    vec3 foot = geometry.position.xyz;
    foot.z += newheat_terrainHeight(foot);
    gl_Position = project_common_position_to_clipspace(vec4(foot, 1.0));
  }
#endif
  if (flameSlices.z > 0.5) {
    // Both heights share the same miter. Reusing the two sides of PathLayer's
    // bevel here gave the top and bottom different joins, exposing a rib at
    // every segment boundary when the ribbon was folded upright.
    vec3 before = project_position(
      mix(instanceLeftPositions, instanceStartPositions, positions.x),
      mix(instanceLeftPositions64Low, instanceStartPositions64Low, positions.x)
    );
    vec3 after = project_position(
      mix(instanceEndPositions, instanceRightPositions, positions.x),
      mix(instanceEndPositions64Low, instanceRightPositions64Low, positions.x)
    );
    vec3 incoming = flameBase - before;
    vec3 outgoing = after - flameBase;
    incoming -= flameUp * dot(incoming, flameUp);
    outgoing -= flameUp * dot(outgoing, flameUp);
    vec3 normalA = length(incoming) > 0.00001 ? normalize(cross(incoming, flameUp)) : sideNormal;
    vec3 normalB = length(outgoing) > 0.00001 ? normalize(cross(outgoing, flameUp)) : sideNormal;
    vec3 miter = normalA + normalB;
    miter = length(miter) > 0.00001 ? normalize(miter) : sideNormal;
    float miterScale = min(1.0 / max(abs(dot(miter, sideNormal)), 0.01), path.miterLimit);
    vec3 offset = -miter * miterScale * flameHalfWidth * flameSlices.y;
    vec3 foot = flameBase + offset;
    foot.z += newheat_terrainHeight(foot);
    gl_Position = project_common_position_to_clipspace(vec4(foot, 1.0));
    flameNormal = sideNormal;
    vTime = mix(instanceTimestamps, instanceNextTimestamps, positions.x);
    // Upright sheets have no cap triangles; keep the upstream path clipping neutral.
    vPathPosition = vec2(flameSlices.y, vPathLength * positions.x);
  }
  float validSegment = step(instanceTypes, 3.5);
  vec3 lift = flameUp * flameHalfWidth * 5.5 * flameSlices.x * validSegment;
  // Offsets must not include project.center a second time (including its w).
  gl_Position += project.viewProjectionMatrix * vec4(lift, 0.0);
  vFlame = flameSlices.xyz;
  vec3 fittedBase = flameBase;
  fittedBase.z += newheat_terrainHeight(fittedBase);
  vec3 viewDirection = project.cameraPosition - fittedBase - lift;
  float viewLength = length(viewDirection);
  viewDirection = viewLength > 0.00001 ? viewDirection / viewLength : flameUp;
  float facing = abs(dot(viewDirection, flameNormal));
  float upFacing = dot(viewDirection, flameUp);
  float sideFacing = dot(viewDirection, sideNormal);
  // Blend the two integration directions by squared facing. Edge-on sheets
  // contribute zero rather than becoming bright lines between volume samples.
  float facingSum = max(upFacing * upFacing + sideFacing * sideFacing, 0.04);
  vFlameWeight = validSegment * flameSlices.w * facing / facingSum;
`;
