import React from 'react';
import OriginalDocCategoryGeneratedIndexPage from '@theme-original/DocCategoryGeneratedIndexPage';

import {WebGpuBadge} from '../../components/docs/webgpu-badge';

export default function DocCategoryGeneratedIndexPage(props) {
  return (
    <>
      <WebGpuBadge docId={`category/${props.categoryGeneratedIndex.slug ?? 'generated'}`} />
      <OriginalDocCategoryGeneratedIndexPage {...props} />
    </>
  );
}
