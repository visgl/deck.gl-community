// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-unresolved */
import {PanWidget as _PanWidget} from '@deck.gl-community/widgets';
import type {PanWidgetProps} from '@deck.gl-community/widgets';
/* eslint-enable import/no-unresolved */
import {useWidget} from '@deck.gl/react';

/** React wrapper for the PanWidget. */
export const PanWidget = (props: PanWidgetProps = {}) => {
  useWidget(_PanWidget, props);
  return null;
};
