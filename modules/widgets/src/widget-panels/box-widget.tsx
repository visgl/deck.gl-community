// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelBox} from '@deck.gl-community/panels';

import type {PanelBoxProps} from '@deck.gl-community/panels';

/**
 * Props for {@link BoxPanelWidget}.
 *
 * This is the deck.gl wrapper surface for {@link PanelBoxProps}.
 */
export type BoxPanelWidgetProps = PanelBoxProps;

/**
 * deck.gl widget wrapper for `PanelBox`.
 */
export class BoxPanelWidget extends PanelBox {}

/**
 * @deprecated Use {@link BoxPanelWidget}.
 */
export type BoxWidgetProps = BoxPanelWidgetProps;

/**
 * @deprecated Use {@link BoxPanelWidget}.
 */
export const BoxWidget = BoxPanelWidget;
