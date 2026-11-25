// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  OrthographicView,
  type Layer,
  type OrthographicViewState,
  type ViewStateChangeParameters,
  type Widget
} from '@deck.gl/core';
import {MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {EXAMPLE_PANEL_STYLE} from './panel-theme';
import type {Device} from '@luma.gl/core';

/** Props accepted by the orthographic trace example. */
export type TraceExampleProps = {
  /** Whether to render the info panel. @defaultValue true */
  showInfoOverlay?: boolean;
  /** Optional rendering device supplied by the website example host. */
  device?: Device;
  /** Optional widgets supplied by the website example host. */
  widgets?: Widget[];
  /** Camera state preserved when the website recreates the graphics backend. */
  initialViewState?: OrthographicViewState;
  /** Reports camera changes to the website example host. */
  onViewStateChange?: <ViewStateT extends OrthographicViewState>(
    params: ViewStateChangeParameters<ViewStateT>
  ) => ViewStateT;
  /** Receives the deck instance so the host can attach its managed canvas. */
  onDeckInitialized?: (deck: Deck<OrthographicView>) => void;
};

export function mountTraceExample(
  container: HTMLElement,
  options: TraceExampleProps,
  layers: Layer[],
  title: string,
  description: string
): () => void {
  const {showInfoOverlay = true} = options;
  const rootElement = createRoot(container);
  const infoWidget = showInfoOverlay
    ? new BoxPanelWidget({
        id: 'trace-info',
        title,
        placement: 'top-left',
        widthPx: 344,
        offsetPx: 16,
        collapsible: true,
        style: EXAMPLE_PANEL_STYLE,
        panel: new MarkdownPanel({
          id: 'trace-description',
          title: '',
          markdown: description
        })
      })
    : null;

  const deck = new Deck({
    device: options.device,
    parent: rootElement,
    views: new OrthographicView({id: 'trace-primitives', flipY: false}),
    initialViewState: options.initialViewState ?? {
      target: [0, 0, 0],
      zoom: 0
    },
    onViewStateChange: options.onViewStateChange,
    controller: true,
    widgets: [...(options.widgets ?? []), ...(infoWidget ? [infoWidget] : [])],
    layers
  });
  options.onDeckInitialized?.(deck);

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

function createRoot(container: HTMLElement): HTMLDivElement {
  const rootElement = container.ownerDocument.createElement('div');
  rootElement.style.position = 'relative';
  rootElement.style.width = '100%';
  rootElement.style.height = '100%';
  rootElement.style.overflow = 'hidden';
  rootElement.style.background = 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)';
  container.replaceChildren(rootElement);
  return rootElement;
}
