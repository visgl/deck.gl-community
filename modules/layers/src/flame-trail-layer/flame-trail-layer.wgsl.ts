// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Native WGSL equivalents of the GLSL volume and ember math. Path geometry,
// timestamp packing and projection stay owned by upstream TripsLayer.
const FLAME_WGSL = /* wgsl */ `
fn flameTrail_vertexHash(n: f32) -> f32 {
  var bits = u32(i32(floor(n * 256.0)));
  bits = (bits ^ (bits >> 16u)) * 0x7feb352du;
  bits = (bits ^ (bits >> 15u)) * 0x846ca68bu;
  bits ^= bits >> 16u;
  return f32(bits & 0x00ffffffu) / 16777216.0;
}

fn flameTrail_hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += vec3<f32>(dot(p3, p3.yzx + vec3<f32>(33.33)));
  return fract((p3.x + p3.y) * p3.z);
}

fn flameTrail_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
  return mix(
    mix(flameTrail_hash(i), flameTrail_hash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(flameTrail_hash(i + vec2<f32>(0.0, 1.0)), flameTrail_hash(i + vec2<f32>(1.0)), u.x), u.y
  );
}

fn flameTrail_fbm(position: vec2<f32>) -> f32 {
  var p = position;
  var n = 0.57 * flameTrail_noise(p);
  p = mat2x2<f32>(vec2<f32>(1.6, -1.2), vec2<f32>(1.2, 1.6)) * p + vec2<f32>(17.3);
  n += 0.28 * flameTrail_noise(p);
  n += 0.15 * flameTrail_noise(p * 2.03 + vec2<f32>(9.2));
  return n;
}

fn flameTrail_vertex(attributes: Attributes, widthPixels: f32, input: Varyings) -> Varyings {
  var result = input;

  result.vEmberUV = vec2<f32>(0.0);
  if (attributes.flameSlices.z > 1.5) {
    var duration: f32 = attributes.instanceTimestamps.y - attributes.instanceTimestamps.x;
    var interval: f32 = max(4.0, duration / 8.0);
    var emissionTime: f32 = (floor(attributes.instanceTimestamps.x / interval) + 1.0 + attributes.flameSlices.x) * interval;
    var anchorSeed: f32 = flameTrail_vertexHash(emissionTime * 0.73);
    var period: f32 = 28.0 + anchorSeed * 35.0;
    var elapsed: f32 = flameTrail.time * 45.0 + anchorSeed * period;
    var cycle: f32 = floor(max(elapsed, 0.0) / period);
    var seed: f32 = flameTrail_vertexHash(emissionTime * 1.37 + cycle * 9.21);
    var lifetime: f32 = 10.0 + seed * 11.0;
    var progress: f32 = (max(elapsed, 0.0) - cycle * period) / lifetime;
    var emberActive: bool = attributes.instanceTypes < 3.5 && duration > 0.0001
      && emissionTime <= attributes.instanceTimestamps.y && emissionTime <= trips.currentTime
      && progress < 1.0 && seed > 0.5;
    result.vTime = emissionTime;
    result.vPathPosition = vec2<f32>(0.0, 0.5);
    result.vPathLength = 1.0;
    result.vFlame = vec3<f32>(progress, seed, 2.0);
    result.vFlameWeight = select(0.0, 1.0, emberActive);
    if (!emberActive) {
      result.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
      return result;
    }
    var fraction: f32 = clamp((emissionTime - attributes.instanceTimestamps.x) / max(duration, 0.0001), 0.0, 1.0);
    var emberBase: vec3<f32> = project_position_vec3_f64(
      mix(attributes.instanceStartPositions, attributes.instanceEndPositions, fraction),
      mix(attributes.instanceStartPositions64Low, attributes.instanceEndPositions64Low, fraction)
    );
    var emberUp: vec3<f32> = vec3<f32>(0.0, 0.0, 1.0);
    let emberRotation = project_needs_rotation(emberBase);
    if (emberRotation.needsRotation) { emberUp = emberRotation.transform * emberUp; }
    var direction: vec3<f32> = project_position_vec3_f64(attributes.instanceEndPositions, attributes.instanceEndPositions64Low)
      - project_position_vec3_f64(attributes.instanceStartPositions, attributes.instanceStartPositions64Low);
    var side: vec3<f32> = cross(direction, emberUp);
    side = select(vec3<f32>(1.0, 0.0, 0.0), normalize(side), length(side) > 0.00001);
    var size: f32 = project_pixel_size_float(widthPixels) * 2.0;
    // Brief, buoyant flecks: a small curl near the plume, then rapid cooling.
    // Each burst has a new seed and a quiet interval, avoiding looping columns.
    var phase: f32 = seed * 6.28;
    var drift: f32 = sin(progress * 4.0 + phase) - sin(phase);
    var rise: f32 = progress * (1.25 + seed * 0.5) * (1.0 - progress * 0.2);
    var emberPosition: vec3<f32> = emberBase + emberUp * size * (0.9 + seed * 0.3 + rise)
      + side * size * (drift * 0.12 + (seed - 0.65) * progress * 0.4);
    result.position = project_common_position_to_clipspace(vec4<f32>(emberPosition, 1.0));
    result.vEmberUV = vec2<f32>(attributes.positions.x * 2.0 - 1.0, attributes.positions.y);
    var sparkSize: vec2<f32> = vec2<f32>(0.65 + seed * 0.35, 0.9 + seed * 0.6) * (1.0 - progress * 0.45);
    result.position = vec4<f32>(result.position.xy + project_pixel_size_to_clipspace(result.vEmberUV * sparkSize) * result.position.w, result.position.zw);
    return result;
  }
  var flameBase: vec3<f32> = project_position_vec3_f64(
    mix(attributes.instanceStartPositions, attributes.instanceEndPositions, attributes.positions.x),
    mix(attributes.instanceStartPositions64Low, attributes.instanceEndPositions64Low, attributes.positions.x)
  );
  var flameUp: vec3<f32> = vec3<f32>(0.0, 0.0, 1.0);
  let flameRotation = project_needs_rotation(flameBase);
  if (flameRotation.needsRotation) {
    flameUp = flameRotation.transform * flameUp;
  }
  var flameHalfWidth: f32 = project_pixel_size_float(widthPixels);
  var tangent: vec3<f32> = project_position_vec3_f64(attributes.instanceEndPositions, attributes.instanceEndPositions64Low)
    - project_position_vec3_f64(attributes.instanceStartPositions, attributes.instanceStartPositions64Low);
  var sideNormal: vec3<f32> = cross(tangent, flameUp);
  sideNormal = select(flameUp, normalize(sideNormal), length(sideNormal) > 0.00001);
  var flameNormal: vec3<f32> = flameUp;

  if (attributes.flameSlices.z > 0.5) {
    // Both heights share the same miter. Reusing the two sides of PathLayer's
    // bevel here gave the top and bottom different joins, exposing a rib at
    // every segment boundary when the ribbon was folded upright.
    var before: vec3<f32> = project_position_vec3_f64(
      mix(attributes.instanceLeftPositions, attributes.instanceStartPositions, attributes.positions.x),
      mix(attributes.instanceLeftPositions64Low, attributes.instanceStartPositions64Low, attributes.positions.x)
    );
    var after: vec3<f32> = project_position_vec3_f64(
      mix(attributes.instanceEndPositions, attributes.instanceRightPositions, attributes.positions.x),
      mix(attributes.instanceEndPositions64Low, attributes.instanceRightPositions64Low, attributes.positions.x)
    );
    var incoming: vec3<f32> = flameBase - before;
    var outgoing: vec3<f32> = after - flameBase;
    incoming -= flameUp * dot(incoming, flameUp);
    outgoing -= flameUp * dot(outgoing, flameUp);
    var normalA: vec3<f32> = select(sideNormal, normalize(cross(incoming, flameUp)), length(incoming) > 0.00001);
    var normalB: vec3<f32> = select(sideNormal, normalize(cross(outgoing, flameUp)), length(outgoing) > 0.00001);
    var miter: vec3<f32> = normalA + normalB;
    miter = select(sideNormal, normalize(miter), length(miter) > 0.00001);
    var miterScale: f32 = min(1.0 / max(abs(dot(miter, sideNormal)), 0.01), path.miterLimit);
    var offset: vec3<f32> = -miter * miterScale * flameHalfWidth * attributes.flameSlices.y;
    var foot: vec3<f32> = flameBase + offset;
    result.position = project_common_position_to_clipspace(vec4<f32>(foot, 1.0));
    flameNormal = sideNormal;
    result.vTime = mix(attributes.instanceTimestamps.x, attributes.instanceTimestamps.y, attributes.positions.x);
    // Upright sheets have no cap triangles; keep the upstream path clipping neutral.
    result.vPathPosition = vec2<f32>(attributes.flameSlices.y, result.vPathLength * attributes.positions.x);
  }
  var validSegment: f32 = step(attributes.instanceTypes, 3.5);
  var lift: vec3<f32> = flameUp * flameHalfWidth * 5.5 * attributes.flameSlices.x * validSegment;
  // Offsets must not include project.center a second time (including its w).
  result.position += project.viewProjectionMatrix * vec4<f32>(lift, 0.0);
  result.vFlame = attributes.flameSlices.xyz;
  var viewDirection: vec3<f32> = project.cameraPosition - flameBase - lift;
  var viewLength: f32 = length(viewDirection);
  viewDirection = select(flameUp, viewDirection / viewLength, viewLength > 0.00001);
  var facing: f32 = abs(dot(viewDirection, flameNormal));
  var upFacing: f32 = dot(viewDirection, flameUp);
  var sideFacing: f32 = dot(viewDirection, sideNormal);
  // Blend the two integration directions by squared facing. Edge-on sheets
  // contribute zero rather than becoming bright lines between volume samples.
  var facingSum: f32 = max(upFacing * upFacing + sideFacing * sideFacing, 0.04);
  result.vFlameWeight = validSegment * attributes.flameSlices.w * facing / facingSum;
  return result;
}


// Apply picking after the flame silhouette and before premultiplication.
fn flameTrail_output(tint: vec4<f32>, flame: vec4<f32>, object: vec3<f32>) -> vec4<f32> {
  if (picking.isActive > 0.5) {
    if (!picking_isColorValid(object)) { discard; }
    return vec4<f32>(object, 1.0);
  }
  var color = tint * flame;
  if (picking.isHighlightActive > 0.5 && picking_isColorZero(abs(
    object - picking_normalizeColor(picking.highlightedObjectColor)))) {
    let alpha = picking.highlightColor.a + color.a * (1.0 - picking.highlightColor.a);
    if (alpha > 0.0) {
      color = vec4<f32>(mix(color.rgb, picking.highlightColor.rgb, picking.highlightColor.a / alpha), alpha);
    }
  }
  return deckgl_premultiplied_alpha(color);
}

fn flameTrail_color(varyings: Varyings) -> vec4<f32> {

  var age: f32 = max(trips.currentTime - varyings.vTime, 0.0);
  var fireTime: f32 = flameTrail.time * 1.5;
  var along: f32 = varyings.vTime * 0.34;
  var height: f32 = varyings.vFlame.x;
  var across: f32 = select(varyings.vPathPosition.x, varyings.vFlame.y, varyings.vFlame.z > 0.5);
  var fuel: f32 = select(1.0, clamp(1.0 - age / max(trips.trailLength, 0.0001), 0.0, 1.0), trips.fadeTrail > 0.5);

  // Advect the noise upward. Two decorrelated fields curl and split the tongues
  // as they rise; the density genuinely varies across the depth of the volume.
  var flow: vec2<f32> = vec2<f32>(along + across * 0.45, height * 4.5 - fireTime * 2.7);
  var curl: f32 = flameTrail_fbm(flow * 0.63 + vec2<f32>(fireTime * 0.3, across));
  var turbulence: f32 = flameTrail_fbm(flow + vec2<f32>(curl * 2.3, across * 2.4));
  var detail: f32 = flameTrail_noise(flow * 2.7 + vec2<f32>(across * 3.2));
  var bend: f32 = (curl - 0.5) * (0.12 + height * 1.8)
    + sin(along * 0.5 - fireTime * 2.0 + height * 8.0) * height * height * 0.3;
  var radius: f32 = abs(across - bend);

  // The leading combustion front swells into a bright, rounded torch head.
  // Its nose closes within the visited time window, never revealing future path.
  var head: f32 = exp(-age * 0.13);
  var nose: f32 = sqrt(max(0.0, 1.0 - pow(1.0 - clamp(age / 5.0, 0.0, 1.0), 2.0)));
  // Let the tip field travel upward and sideways instead of imposing a fixed
  // sawtooth height profile. Tongues bend, split, and pinch off as fuel rises.
  var lick: f32 = flameTrail_noise(vec2<f32>(along * 1.45 + height * 1.8 + curl * 0.7,
    fireTime * 1.4 - height * 4.5));
  var plumeHeight: f32 = (0.2 + pow(lick, 1.5) * 0.65 + head * 0.38) * pow(fuel, 0.7);
  var taper: f32 = pow(max(0.0, 1.0 - height / max(plumeHeight, 0.001)), 0.65);
  var reach: f32 = (0.45 + turbulence * 0.5 + head * 0.14) * taper * nose;
  var feather: f32 = max(fwidth(radius) * 1.25, 0.02);
  var edge: f32 = 1.0 - smoothstep(reach * 0.55 - feather, reach + feather, radius);
  var tongues: f32 = 1.0 - smoothstep(plumeHeight - 0.18, plumeHeight + 0.04, height);
  var broken: f32 = smoothstep(0.22, 0.62, turbulence + (1.0 - height) * 0.25);
  var density: f32 = edge * tongues * broken;
  density *= smoothstep(0.0, 0.035, height) * (0.8 + 0.2 * detail);

  var core: f32 = exp(-radius * radius * 9.0) * (1.0 - smoothstep(0.04, 0.62, height));
  var heat: f32 = clamp(core * 0.75 + turbulence * 0.28 + head * 0.2 - height * 0.28, 0.0, 1.0);
  var fire: vec3<f32> = mix(vec3<f32>(0.8, 0.045, 0.002), vec3<f32>(1.0, 0.3, 0.008), smoothstep(0.05, 0.45, heat));
  fire = mix(fire, vec3<f32>(1.0, 0.76, 0.22), smoothstep(0.4, 0.78, heat));
  fire = mix(fire, vec3<f32>(1.0, 0.98, 0.82), smoothstep(0.72, 1.0, heat));
  // A thin blue reaction zone anchors the orange flame to the path.
  var blueBase: f32 = (1.0 - smoothstep(0.025, 0.12, height)) * (1.0 - core * 0.5);
  fire = mix(fire, vec3<f32>(0.055, 0.18, 1.0), blueBase * 0.75);
  let rgb = fire * (1.0 + core * 0.28 + head * 0.12);
  let alpha = 1.0 - exp(-density * varyings.vFlameWeight * 5.5);

  if (varyings.vFlameWeight <= 0.0) { return vec4<f32>(0.0); }
  if (varyings.vFlame.z > 1.5) {
    var radius: f32 = length(varyings.vEmberUV);
    var life: f32 = varyings.vFlame.x;
    var envelope: f32 = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.25, 1.0, life));
    var flicker: f32 = 0.8 + 0.2 * sin(life * 17.0 + varyings.vFlame.y * 31.0);
    let rgb = mix(vec3<f32>(1.0, 0.52, 0.12), vec3<f32>(0.65, 0.045, 0.003), life);
    let alpha = (1.0 - smoothstep(0.15, 1.0, radius)) * envelope * flicker * 0.65;
    return vec4<f32>(rgb, alpha);
  }
  return select(vec4<f32>(0.0), vec4<f32>(rgb, alpha), density >= 0.005);
}
`;

/** Extend the same WGSL anchors used by TripsLayer, preserving its packed attributes. */
export function getFlameInjectionsWGSL(inject: Record<string, string>) {
  const attributes = '  @location(12) rowIndexes: u32,';
  const varyings = '  @location(5) vJointType: f32,';
  const vertex = '    attributes.instanceColors.a * layer.opacity\n  );';
  return {
    ...inject,
    [attributes]: `${inject[attributes]}\n  @location(14) flameSlices: vec4<f32>,`,
    [varyings]: `${inject[varyings]}
      @location(9) vFlame: vec3<f32>,
      @location(10) vFlameWeight: f32,
      @location(11) vEmberUV: vec2<f32>,
      @location(12) @interpolate(flat) flamePickingColor: vec3<f32>,`,
    'vs:#decl': FLAME_WGSL,
    [vertex]: /* wgsl */ `
      varyings.vTime = mix(attributes.instanceTimestamps.x, attributes.instanceTimestamps.y,
        varyings.vPathPosition.y / max(varyings.vPathLength, 0.0001));
      varyings = flameTrail_vertex(attributes, widthPixels, varyings);
      varyings.flamePickingColor = geometry.pickingColor;
      if (trips.fadeTrail > 0.5) {
        varyings.vColor.a *= 1.0 - (trips.currentTime - varyings.vTime) / max(trips.trailLength, 0.0001);
      }
    `,
    // Derivatives must precede PathLayer/TripsLayer's fragment discards.
    'fs:#main-start': 'let flameColor = flameTrail_color(varyings);',
    '  // DECKGL_FILTER_COLOR': `${inject['  // DECKGL_FILTER_COLOR']}
      if (flameColor.a <= 0.0 || (trips.fadeTrail > 0.5 && trips.trailLength <= 0.0)) { discard; }`
  };
}
