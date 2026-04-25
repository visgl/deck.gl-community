// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelFullScreen} from '../../../panels/src';

import type {PanelFullScreenProps} from '../../../panels/src';

/**
 * Props for {@link FullScreenPanelWidget}.
 *
 * This is the deck.gl wrapper surface for {@link PanelFullScreenProps}.
 */
export type FullScreenPanelWidgetProps = PanelFullScreenProps;

/**
 * deck.gl widget wrapper for `PanelFullScreen`.
 */
export class FullScreenPanelWidget extends PanelFullScreen {}
