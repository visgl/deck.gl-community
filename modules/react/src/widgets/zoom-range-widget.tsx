// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-unresolved */
import {ZoomRangeWidget as _ZoomRangeWidget} from '@deck.gl-community/widgets';
import type {ZoomRangeWidgetProps} from '@deck.gl-community/widgets';
/* eslint-enable import/no-unresolved */
import {useWidget} from '@deck.gl/react';

/** React wrapper for the ZoomRangeWidget. */
export const ZoomRangeWidget = (props: ZoomRangeWidgetProps = {}) => {
  useWidget(_ZoomRangeWidget, props);
  return null;
};
