// Copyright (c) 2015 - 2017 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

export const fs = /* glsl */`\
#define SHADER_NAME flow-path-layer-fragment-shader

precision highp float;

varying vec4 vColor;
varying float segmentIndex;
varying float speed;
varying float offset;
varying float pathLength;
varying float tailLength;

void main(void) {
  gl_FragColor = vColor;

  // use highlight color if this fragment belongs to the selected object.
  gl_FragColor = picking_filterHighlightColor(gl_FragColor);

  // use picking color if rendering to picking FBO.
  gl_FragColor = picking_filterPickingColor(gl_FragColor);

  if (speed == 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    // the portion of the visible segment (0 to 1) , ex: 0.3
    // edge cases: pathLength = 0 or tailLength > pathLength
    float segFragment = 0.0;
    if (pathLength != 0.0) {
      segFragment = tailLength / pathLength;
    }
    if (tailLength > pathLength) {
      segFragment = 1.0;
    }
    float startSegmentIndex = mod(offset, 60.0) / 60.0;
    // the end offset, cap to 1.0 (end of the line)
    float endSegmentIndex = min(startSegmentIndex + segFragment, 1.0);
    if (segmentIndex < startSegmentIndex || segmentIndex > endSegmentIndex) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
      // fading tail
      float portion = (segmentIndex - startSegmentIndex) / segFragment;
      gl_FragColor[3] = portion;
    }
  }
}
`;
