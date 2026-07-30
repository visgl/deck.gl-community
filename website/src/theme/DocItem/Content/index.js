import React from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import OriginalDocItemContent from '@theme-original/DocItem/Content';

import {WebGpuBadge} from '../../../components/docs/webgpu-badge';

export default function DocItemContent({children}) {
  const {metadata} = useDoc();

  return (
    <>
      <WebGpuBadge docId={metadata.id} />
      <OriginalDocItemContent>{children}</OriginalDocItemContent>
    </>
  );
}
