// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {SPLAT_DEFORMATION_WGSL} from './splat-deformation';
export const SPLAT_WGSL = `
${SPLAT_DEFORMATION_WGSL}
struct Attributes {
 @builtin(instance_index) instanceIndex: u32,
 @location(0) splatCorners: vec2<f32>,
 @location(1) splatCenters: vec3<f32>,
 @location(2) splatAxisX: vec3<f32>,
 @location(3) splatAxisY: vec3<f32>,
 @location(4) splatAxisZ: vec3<f32>,
 @location(5) splatColors: vec4<f32>,
 @location(6) splatNormals: vec3<f32>,
 @location(7) instancePositions: vec3<f32>,
 @location(8) instancePositions64Low: vec3<f32>,
 @location(9) instanceColors: vec4<f32>,
 @location(10) instanceModelMatrixCol0: vec3<f32>,
 @location(11) instanceModelMatrixCol1: vec3<f32>,
 @location(12) instanceModelMatrixCol2: vec3<f32>,
 @location(13) instanceTranslation: vec3<f32>,
 @location(14) instanceDeformation: vec4<f32>,
 @location(15) instanceCoverageWeight: vec3<f32>
};
struct Varyings {
 @builtin(position) position: vec4<f32>,
 @location(0) gaussianPosition: vec2<f32>,
 @location(1) color: vec4<f32>,
 @location(2) normal: vec3<f32>,
 @location(3) commonPosition: vec3<f32>,
 @location(4) pickingColor: vec3<f32>,
 @location(5) coverageWeight: f32
};
@vertex fn vertexMain(attributes: Attributes) -> Varyings {
 var output: Varyings;
 geometry.worldPosition = attributes.instancePositions;
 geometry.pickingColor = picking_getPickingColorFromIndex(attributes.instanceIndex);
 let transform = mat3x3<f32>(attributes.instanceModelMatrixCol0, attributes.instanceModelMatrixCol1, attributes.instanceModelMatrixCol2);
 var position = transform * attributes.splatCenters + attributes.instanceTranslation;
 var covariance = transform * mat3x3<f32>(attributes.splatAxisX, attributes.splatAxisY, attributes.splatAxisZ);
 let normalAxisX = cross(transform[1], transform[2]);
 let normalAxisY = cross(transform[2], transform[0]);
 let normalAxisZ = cross(transform[0], transform[1]);
 let normalDeterminant = dot(transform[0], normalAxisX);
 // Cofactors form the inverse transpose, including shear and reflections.
 var normal = mat3x3<f32>(normalAxisX, normalAxisY, normalAxisZ) * attributes.splatNormals;
 normal *= select(1.0, -1.0, normalDeterminant < 0.0) / max(abs(normalDeterminant), 1e-20);
 let height = max(attributes.instanceDeformation.x, 0.001);
 let wave = vec2<f32>(splat.wave.x * attributes.instanceDeformation.w + splat.wave.y * attributes.instanceDeformation.z,
   splat.wave.z * attributes.instanceCoverageWeight.z + splat.wave.w * attributes.instanceCoverageWeight.y);
 if (splat.strength != 0.0) {
  let deformation = splatDeform(position, height, splat.strength * attributes.instanceDeformation.y, wave);
  position = deformation.position;
  covariance = deformation.jacobian * covariance;
  if (splat.mode < 2.5) { normal = splatDeformNormal(deformation.jacobian, normal); }
 }
 let projection = project_position_to_clipspace_and_commonspace(attributes.instancePositions, attributes.instancePositions64Low, project_size_vec3(position));
 var center = projection.clipPosition;
 var viewportSize = project.viewportSize;
 if (splat.mode > 2.5) { center = splat.lightMatrix * projection.commonPosition + splat.lightCenter; viewportSize = splat.lightViewport; }
 geometry.position = projection.commonPosition;
 output.commonPosition = projection.commonPosition.xyz;
 output.normal = project_normal(normal);
 geometry.normal = output.normal;
 // Reuse the perspective Jacobian for all three covariance axes.
 var matrix = project.viewProjectionMatrix;
 if (splat.mode > 2.5) { matrix = splat.lightMatrix; }
 let rowW = vec3<f32>(matrix[0].w, matrix[1].w, matrix[2].w);
 let axisX = project_size_vec3(covariance[0]);
 let axisY = project_size_vec3(covariance[1]);
 let axisZ = project_size_vec3(covariance[2]);
 let depthAxes = vec3<f32>(dot(rowW, axisX), dot(rowW, axisY), dot(rowW, axisZ));
 let depthSigma = length(depthAxes);
 let safeW = max(max(center.w, depthSigma * splat.support * 0.5), 1e-8);
 let ndc = clamp(center.xy / safeW, vec2<f32>(-1.3), vec2<f32>(1.3));
 let rowX = (vec3<f32>(matrix[0].x, matrix[1].x, matrix[2].x) - rowW * ndc.x) * viewportSize.x / (2.0 * safeW);
 let rowY = (vec3<f32>(matrix[0].y, matrix[1].y, matrix[2].y) - rowW * ndc.y) * viewportSize.y / (2.0 * safeW);
 let rowNear = vec3<f32>(matrix[0].z, matrix[1].z, matrix[2].z) + rowW;
 let nearSigma = length(vec3<f32>(dot(rowNear, axisX), dot(rowNear, axisY), dot(rowNear, axisZ)));
 let clipWeight = select(smoothstep(0.0, max(nearSigma * splat.support, 1e-8), center.z + center.w), 1.0, splat.mode > 2.5);
 let x = vec2<f32>(dot(rowX, axisX), dot(rowY, axisX));
 let y = vec2<f32>(dot(rowX, axisY), dot(rowY, axisY));
 let z = vec2<f32>(dot(rowX, axisZ), dot(rowY, axisZ));
 var a = x.x*x.x + y.x*y.x + z.x*z.x;
 let b = x.x*x.y + y.x*y.y + z.x*z.y;
 var c = x.y*x.y + y.y*y.y + z.y*z.y;
 let determinant = max(a*c-b*b, 0.0);
 a += splat.kernelVariance;
 c += splat.kernelVariance;
 let filteredDeterminant = max(a*c-b*b, 1e-12);
 let compensation = sqrt(determinant / filteredDeterminant);
 let middle = 0.5 * (a + c);
 let spread = sqrt(max(0.25*(a-c)*(a-c)+b*b, 0.0));
 let major = max(middle + spread, 1e-8);
 let minor = max(middle - spread, 1e-8);
 var direction = select(vec2<f32>(0.0,1.0), vec2<f32>(1.0,0.0), a >= c);
 if (abs(b) > 1e-8) { direction = normalize(vec2<f32>(b, major-a)); }
 let offset = (direction * sqrt(major) * attributes.splatCorners.x + vec2<f32>(-direction.y,direction.x) * sqrt(minor) * attributes.splatCorners.y) * splat.support;
 output.gaussianPosition = attributes.splatCorners * splat.support;
 output.color = vec4<f32>(attributes.splatColors.rgb * attributes.instanceColors.rgb, attributes.splatColors.a * attributes.instanceColors.a * select(layer.opacity, 1.0, splat.mode > 2.5) * compensation);
 output.position = vec4<f32>(center.xy + offset / viewportSize * 2.0 * center.w, center.zw);
 if (center.w <= 0.0 || center.z < -center.w || output.color.a < splat.alphaCutoff) { output.position = vec4<f32>(2.0,2.0,2.0,1.0); }
 output.pickingColor = geometry.pickingColor;
 output.coverageWeight = attributes.instanceCoverageWeight.x * clipWeight;
 return output;
}
fn gaussianOpticalDepth(input: Varyings) -> f32 {
 let coverage = input.color.a * exp(-0.5 * dot(input.gaussianPosition, input.gaussianPosition));
 if (splat.opticalDepthMode > 0.5) { return coverage * input.coverageWeight; }
 return -log(max(1.0 - coverage, 0.005)) * input.coverageWeight;
}
@fragment fn fragmentMain(input: Varyings) -> @location(0) vec4<f32> {
 let radiusSquared = dot(input.gaussianPosition, input.gaussianPosition);
 if (radiusSquared > splat.support * splat.support) { discard; }
 var alpha = min(0.995, 1.0 - exp(-gaussianOpticalDepth(input)));
 if (splat.opticalDepthMode < 0.5 && input.coverageWeight == 1.0) { alpha = min(0.995, input.color.a * exp(-0.5 * radiusSquared)); }
 if (alpha < splat.alphaCutoff || (picking.isActive > 0.5 && alpha < 0.08)) { discard; }
 geometry.position = vec4<f32>(input.commonPosition, 1.0);
 geometry.normal = input.normal;
 geometry.uv = input.gaussianPosition;
 geometry.pickingColor = input.pickingColor;
 if (picking.isActive > 0.5) {
  if (!picking_isColorValid(input.pickingColor)) { discard; }
  return vec4<f32>(input.pickingColor, 1.0);
 }
 if (splat.mode > 2.5) { return vec4<f32>(alpha); }
 let normal = normalize(input.normal);
 let shaded = lighting_getLightColor2(input.color.rgb, project.cameraPosition, input.commonPosition, normal);
 var color = vec4<f32>(shaded, alpha);
 if (picking.isHighlightActive > 0.5 && picking_isColorZero(abs(input.pickingColor - picking_normalizeColor(picking.highlightedObjectColor)))) {
  color = vec4<f32>(mix(color.rgb, picking.highlightColor.rgb, picking.highlightColor.a), color.a);
 }
 if (splat.mode > 1.5) { return vec4<f32>(alpha); }
 if (splat.mode > 0.5) {
  let weight = clamp(pow(alpha + 0.01, 3.0) * 100.0 * pow(1.0 - input.position.z * 0.9, 3.0), 0.01, 30.0);
  return vec4<f32>(color.rgb * alpha, alpha) * weight;
 }
 return color;
}`;

export const SPLAT_ACCUMULATION_WGSL =
  SPLAT_WGSL.replace(
    '@fragment fn fragmentMain(input: Varyings) -> @location(0)',
    'fn shadeGaussian(input: Varyings) ->'
  ) +
  `
struct SplatOutput { @location(0) accumulation: vec4<f32>, @location(1) opticalDepth: vec4<f32> };
@fragment fn fragmentMain(input: Varyings) -> SplatOutput {
 let accumulation = shadeGaussian(input);
 return SplatOutput(accumulation, vec4<f32>(min(gaussianOpticalDepth(input), 80.0), 0.0, 0.0, 0.0));
}`;
