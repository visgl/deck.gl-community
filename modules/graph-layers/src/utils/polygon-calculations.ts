// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export function generateRoundedCorners(pos, width, height, radius, factor = 20) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const bottomLeft = {X: pos[0] - halfWidth, Y: pos[1] - halfHeight};
  const topLeft = {X: pos[0] - halfWidth, Y: pos[1] + halfHeight};
  const bottomRight = {X: pos[0] + halfWidth, Y: pos[1] - halfHeight};
  const topRight = {X: pos[0] + halfWidth, Y: pos[1] + halfHeight};

  const roundedPointsForBottomLeft = getRoundedCorner(
    bottomLeft,
    topLeft,
    bottomRight,
    radius,
    factor
  );
  const roundedPointsForTopLeft = getRoundedCorner(
    topLeft,
    topRight,
    bottomLeft,
    radius,
    factor
  ).reverse();
  const roundedPointsForTopRight = getRoundedCorner(
    topRight,
    bottomRight,
    topLeft,
    radius,
    factor
  ).reverse();
  const roundedPointsForBottomRight = getRoundedCorner(
    bottomRight,
    bottomLeft,
    topRight,
    radius,
    factor
  ).reverse();

  const result = [
    ...roundedPointsForBottomLeft,
    ...roundedPointsForTopLeft,
    ...roundedPointsForTopRight,
    ...roundedPointsForBottomRight
  ];

  return result;
}

/**
 *
 * @param {*} angularPoint = corner point
 * @param {*} p1 = edge one
 * @param {*} p2 = edge two
 * @param {*} radius = corner radius
 * @param {*} factor = affects the points used for curve
 * reference: https://stackoverflow.com/questions/24771828/how-to-calculate-rounded-corners-for-a-polygon
 */
// eslint-disable-next-line max-statements
function getRoundedCorner(angularPoint, p1, p2, radius, factor) {
  // Vector 1
  const dx1 = angularPoint.X - p1.X;
  const dy1 = angularPoint.Y - p1.Y;

  // Vector 2
  const dx2 = angularPoint.X - p2.X;
  const dy2 = angularPoint.Y - p2.Y;

  // Angle between vector 1 and vector 2 divided by 2
  const angle = (Math.atan2(dy1, dx1) - Math.atan2(dy2, dx2)) / 2;

  // The length of segment between angular point and the
  // points of intersection with the circle of a given radius
  const tan = Math.abs(Math.tan(angle));
  let segment = radius / tan;
  // var segment = 2;

  // Check the segment
  const length1 = getLength(dx1, dy1);
  const length2 = getLength(dx2, dy2);

  const length = Math.min(length1, length2);

  if (segment > length) {
    segment = length;
    radius = length * tan;
  }

  // Points of intersection are calculated by the proportion between
  // the coordinates of the vector, length of vector and the length of the segment.
  const p1Cross = getProportionPoint(angularPoint, segment, length1, dx1, dy1);
  const p2Cross = getProportionPoint(angularPoint, segment, length2, dx2, dy2);

  // Calculation of the coordinates of the circle
  // center by the addition of angular vectors.
  const dx = angularPoint.X * 2 - p1Cross.X - p2Cross.X;
  const dy = angularPoint.Y * 2 - p1Cross.Y - p2Cross.Y;

  const L = getLength(dx, dy);
  const d = getLength(segment, radius);

  const circlePoint = getProportionPoint(angularPoint, d, L, dx, dy);

  // StartAngle and EndAngle of arc
  let startAngle = Math.atan2(p1Cross.Y - circlePoint.Y, p1Cross.X - circlePoint.X);
  const endAngle = Math.atan2(p2Cross.Y - circlePoint.Y, p2Cross.X - circlePoint.X);

  // Sweep angle
  let sweepAngle = endAngle - startAngle;

  // Some additional checks
  if (sweepAngle < 0) {
    startAngle = endAngle;
    sweepAngle = -sweepAngle;
  }

  if (sweepAngle > Math.PI) sweepAngle = Math.PI - sweepAngle;

  const degreeFactor = factor / Math.PI;

  return getPointsForArc(sweepAngle, degreeFactor, startAngle, circlePoint, radius);
}

function getLength(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}

function getProportionPoint(point, segment, length, dx, dy) {
  const factor = segment / length;

  return {
    X: point.X - dx * factor,
    Y: point.Y - dy * factor
  };
}

function getPointsForArc(sweepAngle, degreeFactor, startAngle, circlePoint, radius) {
  const pointsCount = Math.abs(sweepAngle * degreeFactor);
  const sign = Math.sign(sweepAngle);

  const points = [];

  for (let i = 0; i < pointsCount; ++i) {
    const pointX = circlePoint.X + Math.cos(startAngle + (sign * i) / degreeFactor) * radius;

    const pointY = circlePoint.Y + Math.sin(startAngle + (sign * i) / degreeFactor) * radius;

    const point = [pointX, pointY];
    points.push(point);
  }
  return points;
}
