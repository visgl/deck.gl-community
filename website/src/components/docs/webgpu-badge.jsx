import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

import {getDocWebGpuStatus, WEBGPU_STATUS} from './webgpu-support';
import styles from './webgpu-badge.module.css';

export function WebGpuBadge({docId, introduced, deckVersion}) {
  const status = getDocWebGpuStatus(docId);
  const metadata = WEBGPU_STATUS[status];
  const compatibilityUrl = useBaseUrl('/docs/webgpu');

  return (
    <div className={deckVersion ? styles.packageBadgeRow : styles.badgeRow}>
      {introduced && (
        <span className={styles.badge}>
          <span className={styles.name}>From</span>
          <span className={styles.version}>v{introduced}</span>
        </span>
      )}
      {deckVersion && (
        <span className={styles.badge}>
          <span className={styles.name}>deck.gl</span>
          <span className={styles.version}>v{deckVersion}</span>
        </span>
      )}
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
