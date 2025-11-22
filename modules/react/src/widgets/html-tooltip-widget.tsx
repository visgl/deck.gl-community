// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-unresolved */
import {HtmlTooltipWidget as _HtmlTooltipWidget} from '@deck.gl-community/widgets';
import type {HtmlTooltipWidgetProps} from '@deck.gl-community/widgets';
/* eslint-enable import/no-unresolved */
import {useWidget} from '@deck.gl/react';

/** React wrapper for the HtmlTooltipWidget. */
export const HtmlTooltipWidget = (props: HtmlTooltipWidgetProps = {}) => {
  useWidget(_HtmlTooltipWidget, props);
  return null;
};
