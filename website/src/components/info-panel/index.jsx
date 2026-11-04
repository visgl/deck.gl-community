/* eslint import/namespace: ['error', { allowComputed: true }] */
import React, {useEffect, useRef} from 'react';
import {BoxPanelContainer, PanelManager} from '@deck.gl-community/panels';
import {useReactPanel} from '@deck.gl-community/react';
import {EXAMPLE_PANEL_STYLE} from '../../../../examples/utils/panel-theme';
import styles from './index.module.css';

import GenericInput from '../input';
import Spinner from '../spinner';

function InfoPanel({title, children, sourceLink}) {
  const hostRef = useRef(null);
  const {panel, portal} = useReactPanel({
    title,
    children: (
      <>
        {children}
        {sourceLink && (
          <a className={styles.sourceLink} href={sourceLink} target="_blank" rel="noreferrer">
            View Code ↗
          </a>
        )}
      </>
    )
  });

  useEffect(() => {
    const manager = new PanelManager({
      parentElement: hostRef.current,
      components: [
        new BoxPanelContainer({
          id: 'example-info',
          title,
          panel,
          placement: 'top-right',
          widthPx: 344,
          offsetPx: 16,
          collapsible: true,
          style: EXAMPLE_PANEL_STYLE
        })
      ]
    });
    return () => {
      manager.finalize();
    };
  }, [panel, title]);

  return (
    <>
      <div className={styles.panelHost} ref={hostRef} />
      {portal}
    </>
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
