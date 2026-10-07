// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const FLAME_FUNCTIONS = /* glsl */ `
in vec3 vFlame;
in float vFlameWeight;
in vec2 vEmberUV;

float flameTrail_hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float flameTrail_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(flameTrail_hash(i), flameTrail_hash(i + vec2(1.0, 0.0)), u.x),
    mix(flameTrail_hash(i + vec2(0.0, 1.0)), flameTrail_hash(i + vec2(1.0)), u.x), u.y
  );
}

float flameTrail_fbm(vec2 p) {
  // Fixed-cost turbulence: three octaves, no textures or extra draw calls.
  float n = 0.57 * flameTrail_noise(p);
  p = mat2(1.6, -1.2, 1.2, 1.6) * p + 17.3;
  n += 0.28 * flameTrail_noise(p);
  n += 0.15 * flameTrail_noise(p * 2.03 + 9.2);
  return n;
}


`;

export const FLAME_COLOR = /* glsl */ `
  if (vFlameWeight <= 0.0) discard;
  if (vFlame.z > 1.5) {
    float radius = length(vEmberUV);
    if (radius > 1.0) discard;
    float life = vFlame.x;
    float envelope = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.25, 1.0, life));
    float flicker = 0.8 + 0.2 * sin(life * 17.0 + vFlame.y * 31.0);
    color.rgb *= mix(vec3(1.0, 0.52, 0.12), vec3(0.65, 0.045, 0.003), life);
    color.a *= (1.0 - smoothstep(0.15, 1.0, radius)) * envelope * flicker * 0.65;
  } else {
  float age = max(trips.currentTime - vTime, 0.0);
  float fireTime = flameTrail.time * 1.5;
  float along = vTime * 0.34;
  float height = vFlame.x;
  float across = vFlame.z > 0.5 ? vFlame.y : geometry.uv.x;
  float fuel = trips.fadeTrail
    ? clamp(1.0 - age / max(trips.trailLength, 0.0001), 0.0, 1.0) : 1.0;

  // Advect the noise upward. Two decorrelated fields curl and split the tongues
  // as they rise; the density genuinely varies across the depth of the volume.
  vec2 flow = vec2(along + across * 0.45, height * 4.5 - fireTime * 2.7);
  float curl = flameTrail_fbm(flow * 0.63 + vec2(fireTime * 0.3, across));
  float turbulence = flameTrail_fbm(flow + vec2(curl * 2.3, across * 2.4));
  float detail = flameTrail_noise(flow * 2.7 + across * 3.2);
  float bend = (curl - 0.5) * (0.12 + height * 1.8)
    + sin(along * 0.5 - fireTime * 2.0 + height * 8.0) * height * height * 0.3;
  float radius = abs(across - bend);

  // The leading combustion front swells into a bright, rounded torch head.
  // Its nose closes within the visited time window, never revealing future path.
  float head = exp(-age * 0.13);
  float nose = sqrt(max(0.0, 1.0 - pow(1.0 - clamp(age / 5.0, 0.0, 1.0), 2.0)));
  // Let the tip field travel upward and sideways instead of imposing a fixed
  // sawtooth height profile. Tongues bend, split, and pinch off as fuel rises.
  float lick = flameTrail_noise(vec2(along * 1.45 + height * 1.8 + curl * 0.7,
    fireTime * 1.4 - height * 4.5));
  float plumeHeight = (0.2 + pow(lick, 1.5) * 0.65 + head * 0.38) * pow(fuel, 0.7);
  float taper = pow(max(0.0, 1.0 - height / max(plumeHeight, 0.001)), 0.65);
  float reach = (0.45 + turbulence * 0.5 + head * 0.14) * taper * nose;
  float feather = max(fwidth(radius) * 1.25, 0.02);
  float edge = 1.0 - smoothstep(reach * 0.55 - feather, reach + feather, radius);
  float tongues = 1.0 - smoothstep(plumeHeight - 0.18, plumeHeight + 0.04, height);
  float broken = smoothstep(0.22, 0.62, turbulence + (1.0 - height) * 0.25);
  float density = edge * tongues * broken;
  density *= smoothstep(0.0, 0.035, height) * (0.8 + 0.2 * detail);
  if (density < 0.005) discard;

  float core = exp(-radius * radius * 9.0) * (1.0 - smoothstep(0.04, 0.62, height));
  float heat = clamp(core * 0.75 + turbulence * 0.28 + head * 0.2 - height * 0.28, 0.0, 1.0);
  vec3 fire = mix(vec3(0.8, 0.045, 0.002), vec3(1.0, 0.3, 0.008), smoothstep(0.05, 0.45, heat));
  fire = mix(fire, vec3(1.0, 0.76, 0.22), smoothstep(0.4, 0.78, heat));
  fire = mix(fire, vec3(1.0, 0.98, 0.82), smoothstep(0.72, 1.0, heat));
  // A thin blue reaction zone anchors the orange flame to the path.
  float blueBase = (1.0 - smoothstep(0.025, 0.12, height)) * (1.0 - core * 0.5);
  fire = mix(fire, vec3(0.055, 0.18, 1.0), blueBase * 0.75);
  color.rgb *= fire * (1.0 + core * 0.28 + head * 0.12);
  color.a *= 1.0 - exp(-density * vFlameWeight * 5.5);
  }
`;
