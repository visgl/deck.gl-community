// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Ported from https://github.com/ubilabs/outlined-path-layer (MIT license)

export const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME outlined-path-layer-vertex-shader

in vec2 positions;

in float instanceTypes;
in vec3 instanceStartPositions;
in vec3 instanceEndPositions;
in vec3 instanceLeftPositions;
in vec3 instanceRightPositions;
in vec3 instanceLeftPositions64Low;
in vec3 instanceStartPositions64Low;
in vec3 instanceEndPositions64Low;
in vec3 instanceRightPositions64Low;
in float instanceStrokeWidths;
in float instanceOutlineWidths;
in vec4 instanceColors;
in vec4 instanceOutlineColors;
in vec3 instancePickingColors;

out vec4 vColorInner;
out vec4 vColorOutline;
out float vWidthRatio;
out vec2 vWidths;

out vec2 vCornerOffset;
out float vMiterLength;
out vec2 vPathPosition;
out float vPathLength;
out float vJointType;
out float vIsCap;

const float EPSILON = 0.001;
const vec3 ZERO_OFFSET = vec3(0.0);

float flipIfTrue(bool flag) {
  return -(float(flag) * 2. - 1.);
}

vec3 getLineJoinOffset(
  vec3 prevPoint, vec3 currPoint, vec3 nextPoint,
  vec2 width, float widthRatio
) {
  bool isEnd = positions.x > 0.0;
  float sideOfPath = positions.y;
  float isJoint = float(sideOfPath == 0.0);

  vec3 deltaA3 = (currPoint - prevPoint);
  vec3 deltaB3 = (nextPoint - currPoint);

  mat3 rotationMatrix;
  bool needsRotation = !path.billboard && project_needs_rotation(currPoint, rotationMatrix);
  if (needsRotation) {
    deltaA3 = deltaA3 * rotationMatrix;
    deltaB3 = deltaB3 * rotationMatrix;
  }

  vec2 deltaA = deltaA3.xy / width;
  vec2 deltaB = deltaB3.xy / width;

  float lenA = length(deltaA);
  float lenB = length(deltaB);

  vec2 dirA = lenA > 0. ? normalize(deltaA) : vec2(0.0, 0.0);
  vec2 dirB = lenB > 0. ? normalize(deltaB) : vec2(0.0, 0.0);

  vec2 perpA = vec2(-dirA.y, dirA.x);
  vec2 perpB = vec2(-dirB.y, dirB.x);

  vec2 dir = isEnd ? dirA : dirB;
  vec2 perp = isEnd ? perpA : perpB;
  float L = isEnd ? lenA : lenB;

  vec2 offsetVec;

  bool isStartCap = lenA == 0.0 || (!isEnd && (instanceTypes == 1.0 || instanceTypes == 3.0));
  bool isEndCap = lenB == 0.0 || (isEnd && (instanceTypes == 2.0 || instanceTypes == 3.0));
  bool isCap = isStartCap || isEndCap;
  vIsCap = float(isCap);

  if (isCap) {
    vJointType = path.capType;
    float capSign = flipIfTrue(isStartCap);

    if (path.capType > 0.5) {
      offsetVec = mix(perp * sideOfPath, dir * 64.0 * capSign, isJoint);
    } else {
      float capLength = (1.0 - widthRatio);
      offsetVec = (perp * sideOfPath) + (dir * capLength * capSign);
    }
  } else {
    vJointType = path.jointType;
    vec2 tangent = dirA + dirB;
    tangent = length(tangent) > 0. ? normalize(tangent) : perpA;
    vec2 miterVec = vec2(-tangent.y, tangent.x);
    float sinHalfA = abs(dot(miterVec, perp));
    float turnDirection = flipIfTrue(dirA.x * dirB.y >= dirA.y * dirB.x);
    float cornerPosition = sideOfPath * turnDirection;
    float miterSize = 1.0 / max(sinHalfA, EPSILON);
    float cosHalfA = abs(dot(dirA, miterVec));
    miterSize = mix(
      min(miterSize, max(lenA, lenB) / max(cosHalfA, EPSILON)),
      miterSize,
      step(0.0, cornerPosition)
    );
    offsetVec = mix(miterVec * miterSize, perp, step(0.5, cornerPosition))
    * (sideOfPath + isJoint * turnDirection);
  }

  vPathLength = L;
  vCornerOffset = offsetVec;
  vMiterLength = 0.0;
  if (!isCap) {
    vec2 tangent = dirA + dirB;
    tangent = length(tangent) > 0. ? normalize(tangent) : perpA;
    vec2 miterVec = vec2(-tangent.y, tangent.x);
    float turnDirection = flipIfTrue(dirA.x * dirB.y >= dirA.y * dirB.x);
    vMiterLength = dot(vCornerOffset, miterVec * turnDirection);
  }
  vec2 offsetFromStartOfPath = vCornerOffset + deltaA * float(isEnd);
  vPathPosition = vec2(
    dot(offsetFromStartOfPath, perp),
    dot(offsetFromStartOfPath, dir)
  );

  geometry.uv = vPathPosition;
  float isValid = step(instanceTypes, 3.5);
  vec3 offset = vec3(offsetVec * width * isValid, 0.0);
  if (needsRotation) {
    offset = rotationMatrix * offset;
  }
  return offset;
}

void clipLine(inout vec4 position, vec4 refPosition) {
  if (position.w < EPSILON) {
    float r = (EPSILON - refPosition.w) / (position.w - refPosition.w);
    position = refPosition + (position - refPosition) * r;
  }
}

void main() {
  geometry.pickingColor = instancePickingColors;
  vColorInner = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  vColorOutline = vec4(instanceOutlineColors.rgb, instanceOutlineColors.a * layer.opacity);

  float isEnd = positions.x;
  vec3 prevPosition = mix(instanceLeftPositions, instanceStartPositions, isEnd);
  vec3 currPosition = mix(instanceStartPositions, instanceEndPositions, isEnd);
  vec3 nextPosition = mix(instanceEndPositions, instanceRightPositions, isEnd);
  vec3 prevPosition64Low = mix(instanceLeftPositions64Low, instanceStartPositions64Low, isEnd);
  vec3 currPosition64Low = mix(instanceStartPositions64Low, instanceEndPositions64Low, isEnd);
  vec3 nextPosition64Low = mix(instanceEndPositions64Low, instanceRightPositions64Low, isEnd);
  geometry.worldPosition = currPosition;

  float innerWidthPixels = clamp(
    project_size_to_pixel(instanceStrokeWidths * path.widthScale, path.widthUnits),
    path.widthMinPixels, path.widthMaxPixels
  );
  float outlineWidthPixels = clamp(
    project_size_to_pixel(instanceOutlineWidths * path.widthScale, outline.outlineWidthUnits),
    outline.outlineMinPixels,
    outline.outlineMaxPixels
  );

  vWidths = vec2(innerWidthPixels, outlineWidthPixels);

  float totalWidthPixels = innerWidthPixels + outlineWidthPixels * 2.0;

  vWidthRatio = totalWidthPixels > 0.0 ? innerWidthPixels / totalWidthPixels : 1.0;
  vec2 widthPixels = vec2(totalWidthPixels / 2.0);
  vec3 width;

  if (path.billboard) {
    vec4 prevPositionScreen = project_position_to_clipspace(prevPosition, prevPosition64Low, ZERO_OFFSET);
    vec4 currPositionScreen = project_position_to_clipspace(currPosition, currPosition64Low, ZERO_OFFSET, geometry.position);
    vec4 nextPositionScreen = project_position_to_clipspace(nextPosition, nextPosition64Low, ZERO_OFFSET);
    clipLine(prevPositionScreen, currPositionScreen);
    clipLine(nextPositionScreen, currPositionScreen);
    clipLine(currPositionScreen, mix(nextPositionScreen, prevPositionScreen, isEnd));
    width = vec3(widthPixels, 0.0);
    DECKGL_FILTER_SIZE(width, geometry);
    vec3 offset = getLineJoinOffset(
      prevPositionScreen.xyz / prevPositionScreen.w,
      currPositionScreen.xyz / currPositionScreen.w,
      nextPositionScreen.xyz / nextPositionScreen.w,
      project_pixel_size_to_clipspace(width.xy),
      vWidthRatio
    );
    DECKGL_FILTER_GL_POSITION(currPositionScreen, geometry);
    gl_Position = vec4(currPositionScreen.xyz + offset * currPositionScreen.w, currPositionScreen.w);
  } else {
    prevPosition = project_position(prevPosition, prevPosition64Low);
    currPosition = project_position(currPosition, currPosition64Low);
    nextPosition = project_position(nextPosition, nextPosition64Low);
    width = vec3(project_pixel_size(widthPixels), 0.0);
    DECKGL_FILTER_SIZE(width, geometry);

    vec3 offset = getLineJoinOffset(
      prevPosition, currPosition, nextPosition,
      width.xy,
      vWidthRatio
    );
    geometry.position = vec4(currPosition + offset, 1.0);
    gl_Position = project_common_position_to_clipspace(geometry.position);
    DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  }
  DECKGL_FILTER_COLOR(vColorInner, geometry);
  DECKGL_FILTER_COLOR(vColorOutline, geometry);
}
`;
