// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ComponentChildren, JSX} from 'preact';

export type HtmlOverlayItemProps = {
  /** Injected by HtmlOverlayWidget */
  x?: number;
  /** Injected by HtmlOverlayWidget */
  y?: number;

  /** Coordinates of this overlay in [lng, lat] (and optional z). */
  coordinates: number[];
  children?: ComponentChildren;
  style?: JSX.CSSProperties;
};

export function HtmlOverlayItem({x = 0, y = 0, children, style, ...props}: HtmlOverlayItemProps) {
  const {zIndex = 'auto', ...remainingStyle} = style || {};

  return (
    // Using transform translate to position overlay items will result in a smooth zooming
    // effect, whereas using the top/left css properties will cause overlay items to
    // jiggle when zooming
    <div
      style={{transform: `translate(${x}px, ${y}px)`, position: 'absolute', zIndex: `${zIndex}`}}
    >
      <div style={{userSelect: 'none', ...remainingStyle}} {...props}>
        {children}
      </div>
    </div>
  );
}
