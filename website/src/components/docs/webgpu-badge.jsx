import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

import {getDocWebGpuStatus, WEBGPU_STATUS} from './webgpu-support';
import styles from './webgpu-badge.module.css';

export function WebGpuBadge({docId}) {
  const status = getDocWebGpuStatus(docId);
  const metadata = WEBGPU_STATUS[status];
  const compatibilityUrl = useBaseUrl('/docs/webgpu');

  return (
    <div className={styles.badgeRow}>
      <a
        className={styles.badge}
        data-webgpu-status={status}
        href={compatibilityUrl}
        title={`${metadata.description} Open the WebGPU compatibility matrix.`}
      >
        <span className={styles.name}>WebGPU</span>
        <span className={styles[status]}>{metadata.label}</span>
      </a>
    </div>
  );
}
