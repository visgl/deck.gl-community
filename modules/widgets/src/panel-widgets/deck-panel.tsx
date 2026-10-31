// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Panel} from '@deck.gl-community/panels';
import {useLayoutEffect, useRef} from 'preact/hooks';
import {registerDeckPanel} from './deck-panel-scene';
import type {PanelProps} from '@deck.gl-community/panels';
import type {Deck} from '@deck.gl/core';
import type {DeckPanelSceneProps} from './deck-panel-scene';

/** Props for a panel displaying a caller-defined scene on a shared Deck instance. */
export type DeckPanelProps = PanelProps & {
  /** Content is provided by sceneProps instead of arbitrary panel markup. */
  content?: never;
  /** Initialized Deck constructed with _canvases. The panel never owns or finalizes it. */
  deck: Deck<any>;
  /** View, layers and controlled camera supplied by the caller. */
  sceneProps: DeckPanelSceneProps;
  /** Canvas CSS height, in pixels when numeric. Defaults to 240. */
  height?: number | string;
};

/**
 * A panel-owned canvas rendered by an existing Deck using its 9.4 multi-canvas API.
 * Mount after Deck.onLoad. Use setDeckPropsWithPanels for root scene updates.
 */
export class DeckPanel extends Panel<DeckPanelProps> {
  /** Render a canvas whose lifetime follows the mounted panel content. */
  override renderContent() {
    return <DeckPanelContent {...this.props} />;
  }
}

let nextCanvasId = 0;

function DeckPanelContent({deck, sceneProps, height = 240}: DeckPanelProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const registration = useRef<ReturnType<typeof registerDeckPanel> | null>(null);
  useLayoutEffect(() => {
    const element = canvas.current!;
    let id: string;
    do {
      id = `deck-panel-canvas-${++nextCanvasId}`;
    } while (document.getElementById(id));
    element.id = id;
    registration.current = registerDeckPanel(deck, element, sceneProps);
    return () => {
      registration.current?.remove();
      registration.current = null;
    };
  }, [deck]);
  useLayoutEffect(() => {
    registration.current?.update(sceneProps);
  }, [deck, sceneProps]);
  return (
    <div className="deck-panel-canvas" style={{width: '100%', height, position: 'relative'}}>
      <canvas ref={canvas} style={{display: 'block', width: '100%', height: '100%'}} />
    </div>
  );
}
