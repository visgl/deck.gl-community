// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-unresolved */
import {HtmlOverlayWidget as _HtmlOverlayWidget} from '@deck.gl-community/widgets';
import type {HtmlOverlayWidgetProps} from '@deck.gl-community/widgets';
/* eslint-enable import/no-unresolved */
import {useWidget} from '@deck.gl/react';

/** React wrapper for the HtmlOverlayWidget. */
export const HtmlOverlayWidget = (props: HtmlOverlayWidgetProps = {}) => {
  useWidget(_HtmlOverlayWidget, props);
  return null;
};
