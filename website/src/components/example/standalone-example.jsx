import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {GITHUB_TREE} from '../../constants/defaults';
import styles from './standalone-example.module.css';

export default function StandaloneExample({name, title}) {
  const demoUrl = useBaseUrl(`/demos/${name}/index.html`);
  return (
    <div className={styles.host}>
      <iframe title={title} src={demoUrl} allowFullScreen />
      <div>
        <a href={demoUrl}>Open standalone demo</a>
        <a href={`${GITHUB_TREE}/examples/layers/${name}`}>Example source</a>
      </div>
    </div>
  );
}
