import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

import {MainExamples, ExamplesGroup, ExampleCard, ExampleTitle} from './styled';

function GalleryCard({demo}) {
  const href = useBaseUrl(demo.href);
  const thumbnail = useBaseUrl(demo.thumbnail);

  return (
    <ExampleCard href={href} target="_blank" rel="noreferrer" aria-label={demo.title}>
      <img width="100%" src={thumbnail} alt={demo.title} />
      <ExampleTitle>
        <span>{demo.title}</span>
      </ExampleTitle>
    </ExampleCard>
  );
}

export default function GalleryTiles({demos}) {
  if (!demos?.length) {
    return <p className="margin-bottom--lg">No scripting gallery items are available yet.</p>;
  }

  return (
    <MainExamples>
      <ExamplesGroup>
        {demos.map(demo => (
          <GalleryCard key={demo.id} demo={demo} />
        ))}
      </ExamplesGroup>
    </MainExamples>
  );
}

