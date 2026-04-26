/* eslint import/namespace: ['error', { allowComputed: true }] */
import React, {useState} from 'react';
import {PanelContainer, PanelContent, PanelTitle, PanelExpander, SourceLink} from './styled';
import styles from './index.module.css';

import GenericInput from '../input';
import Spinner from '../spinner';

function InfoPanel({title, children, sourceLink}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <PanelContainer>
      <PanelTitle onClick={() => setIsExpanded(!isExpanded)}>
        <div>{title}</div>
        <PanelExpander $expanded={isExpanded}>{isExpanded ? '✕' : 'i'}</PanelExpander>
      </PanelTitle>
      <PanelContent $expanded={isExpanded}>{children}</PanelContent>
      <SourceLink $expanded={isExpanded} href={sourceLink} target="_new">
        View Code ↗
      </SourceLink>
    </PanelContainer>
  );
}

export default function ExampleInfoPanel({title, sourceLink, params, meta, children, updateParam}) {
  return (
    <InfoPanel title={title} sourceLink={sourceLink}>
      <div className={styles.infoPanelContent}>
        {children}

        {Object.keys(params).length > 0 && <hr />}

        {Object.keys(params)
          .sort()
          .map((name, i) => (
            <GenericInput
              key={`${i}-${name}`}
              name={name}
              {...params[name]}
              onChange={updateParam}
            />
          ))}
      </div>

      <Spinner meta={meta} />
    </InfoPanel>
  );
}
