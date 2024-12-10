// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ViewControl} from './view-control';
import React from 'react';



// A wrapper for positioning the ViewControl component
export const PositionedViewControl = ({fitBounds, panBy, zoomBy, zoomLevel, maxZoom = 20, minZoom = -20}) => (
  <div style={{position: 'relative', top: '20px', left: '20px'}}>
    <ViewControl
      fitBounds={fitBounds}
      panBy={panBy}
      zoomBy={zoomBy}
      zoomLevel={zoomLevel}
      maxZoom={maxZoom}
      minZoom={minZoom}
    />
  </div>
);
