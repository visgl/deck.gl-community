import ViewControl from './view-control';
import React from 'react';

// A wrapper for positioning the ViewControl component
export const PositionedViewControl = ({fitBounds, panBy, zoomBy, zoomLevel, maxZoom, minZoom}) => (
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
