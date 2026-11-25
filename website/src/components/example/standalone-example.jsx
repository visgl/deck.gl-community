import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {GITHUB_TREE} from '../../constants/defaults';
import styles from './standalone-example.module.css';

export default function StandaloneExample({name, title}) {
  return (
    <div className={styles.host}>
      <iframe title={title} src={useBaseUrl(`/demos/${name}/index.html`)} allowFullScreen />
      <a href={`${GITHUB_TREE}/examples/layers/${name}`}>Example source</a>
    </div>
  );
}
