// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type HtmlOverlayItemProps = {
  /** Coordinates of this overlay in [lng, lat] (and optional z). */
  coordinates: number[];
  style?: Partial<CSSStyleDeclaration>;
  zIndex?: number | string;
};

/**
 * Create a positioned overlay item element.
 * The returned div uses CSS `transform: translate()` for smooth zooming.
 */
export function createOverlayItemElement(
  props: HtmlOverlayItemProps,
  x: number,
  y: number
): HTMLDivElement {
  const outer = document.createElement('div');
  outer.style.transform = `translate(${x}px, ${y}px)`;
  outer.style.position = 'absolute';
  outer.style.zIndex = `${props.zIndex ?? 'auto'}`;

  const inner = document.createElement('div');
  inner.style.userSelect = 'none';
  if (props.style) {
    const {zIndex: _z, ...rest} = props.style as Record<string, string>;
    Object.assign(inner.style, rest);
  }

  outer.appendChild(inner);
  return outer;
}
