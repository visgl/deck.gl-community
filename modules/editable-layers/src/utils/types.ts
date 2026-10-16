// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type LayerMouseEventResult = {
  eventConsumed?: boolean;
  eventSoftConsumed?: boolean;
  mousePointer?: string | null | undefined;
  shouldRedraw?: boolean | string[];
};

// [red, green, blue, alpha] in premultiplied alpha format
export type Color = [number, number, number, number];

export type Viewport = {
  width: number;
  height: number;
  longitude: number;
  latitude: number;
  zoom: number;
  isDragging?: boolean;
  isMoving?: boolean;
  bearing?: number;
  pitch?: number;
};
