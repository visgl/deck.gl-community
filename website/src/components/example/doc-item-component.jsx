import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import FullscreenExample from './fullscreen-example';
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
    <FullscreenExample className={styles.demoContainer} key={route.path}>
      <MDXComponent />
    </FullscreenExample>
  );
}
