import React from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import OriginalDocItemContent from '@theme-original/DocItem/Content';

import {WebGpuBadge} from '../../../components/docs/webgpu-badge';

export default function DocItemContent({children}) {
  const {metadata, frontMatter} = useDoc();

  return (
    <>
      <WebGpuBadge
        docId={metadata.id}
        introduced={frontMatter.introduced}
        deckVersion={frontMatter.deckVersion}
      />
      <OriginalDocItemContent>{children}</OriginalDocItemContent>
    </>
  );
}
