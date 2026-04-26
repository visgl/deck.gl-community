// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelFullScreen} from '@deck.gl-community/panels';

import type {PanelFullScreenProps} from '@deck.gl-community/panels';

/**
 * Props for {@link FullScreenPanelWidget}.
 *
 * This is the deck.gl wrapper surface for {@link PanelFullScreenProps}.
 */
export type FullScreenPanelWidgetProps = PanelFullScreenProps;

/**
 * deck.gl widget wrapper for `PanelFullScreen`.
 */
export class FullScreenPanelWidget extends PanelFullScreen {
  className = 'deck-widget-full-screen';
}
