import React from 'react';
// Note: `useDocsSidebar()` is internal API and may change in a future release
// https://github.com/facebook/docusaurus/discussions/7457
// Looks like it did https://github.com/facebook/docusaurus/discussions/7457#discussioncomment-10506255
import {useDocsSidebar} from '@docusaurus/plugin-content-docs/client';
import useBaseUrl from '@docusaurus/useBaseUrl';

import {MainExamples, ExamplesGroup, ExampleCard, ExampleHeader, ExampleTitle} from './styled';

function renderItem(item, getThumbnail) {
  const imageUrl = useBaseUrl(getThumbnail(item));
  const {label, href} = item;

  return (
    <ExampleCard key={label} href={href}>
      <img width="100%" src={imageUrl} alt={label} />
      <ExampleTitle>
        <span>{label}</span>
      </ExampleTitle>
    </ExampleCard>
  );
}

function renderCategory({label, items}, getThumbnail) {
  return [
    <ExampleHeader key={`${label}-header`}>{label}</ExampleHeader>,
    <ExamplesGroup key={label}>{items.map(item => renderItem(item, getThumbnail))}</ExamplesGroup>
  ];
}

export default function ExamplesIndex({getThumbnail}) {
  const sidebar = useDocsSidebar();

  console.log(sidebar)
  return (
    <MainExamples>
      {sidebar.items.map(item => {
        if (item.type === 'category') {
          return renderCategory(item, getThumbnail);
        }
        return null;
      })}
    </MainExamples>
  );
}
