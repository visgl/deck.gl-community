import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function StandaloneExample({name, title}) {
  return (
    <iframe
      title={title}
      src={useBaseUrl(`/demos/${name}/index.html`)}
      allowFullScreen
      style={{width: '100%', height: '75vh', border: 0}}
    />
  );
}
