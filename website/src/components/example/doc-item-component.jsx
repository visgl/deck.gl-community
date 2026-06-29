import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './doc-item-component.module.css';

/** Passed to @docusaurus/plugin-content-docs to render the mdx content */
export default function DocItem({content, route}) {
  const MDXComponent = content;
  const indexPath = useBaseUrl('/examples');

  if (route.path === indexPath) {
    return (
      <div key="index">
        <MDXComponent />
      </div>
    );
  }

  return (
    <div className={styles.demoContainer} key="demo">
      <MDXComponent />
    </div>
  );
}
