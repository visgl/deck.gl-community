import React from 'react';
import styled from 'styled-components';
import useBaseUrl from '@docusaurus/useBaseUrl';

const DemoContainer = styled.div`
  position: relative;
  overflow: hidden !important;
  width: 100%;
  height: calc(100vh - var(--ifm-navbar-height) - 24px);
  min-height: calc(100vh - var(--ifm-navbar-height) - 24px);

  > h1 {
    display: none;
  }
`;

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
    <DemoContainer key="demo">
      <MDXComponent />
    </DemoContainer>
  );
}
