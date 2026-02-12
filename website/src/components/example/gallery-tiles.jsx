import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import {MainExamples, ExamplesGroup, ExampleCard, ExampleTitle} from './styled';

function GalleryCard({demo}) {
  const {
    siteConfig: {baseUrl}
  } = useDocusaurusContext();

  const applyBaseUrl = value => {
    if (!value || /^(https?:)?\/\//.test(value)) {
      return value;
    }

    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${normalizedBase}${value.replace(/^\//, '')}`;
  };

  const href = applyBaseUrl(demo.href);
  const thumbnail = applyBaseUrl(demo.thumbnail);

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

