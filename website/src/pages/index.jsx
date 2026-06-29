import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';

import {Home} from '../components';
import styles from './index.module.css';

const HeroExample = () => {
  const src = useBaseUrl('/images/hero-editable-3d-tiles.jpg');
  return (
    <img
      className={styles.heroImage}
      src={src}
      alt="deck.gl-community editable 3D tiles over the Grand Canyon"
    />
  );
};

export default function IndexPage() {
  const baseUrl = useBaseUrl('/');

  return (
    <Layout
      title="Experimental layers, basemaps & add-ons"
      description="deck.gl-community is a collection of experimental add-on modules for deck.gl — advanced layer types, basemap integrations, editable GeoJSON, 3D tiles, graph & infovis layers, and more."
    >
      <Home HeroExample={HeroExample}>
        <div style={{position: 'relative'}}>
          <div
            className={styles.featureImage}
            style={{backgroundImage: `url(${baseUrl}images/maps.jpg)`}}
          />
          <div className={styles.textContainer}>
            <h2>
              deck.gl-community is a set of experimental add-on modules for deck.gl.
            </h2>
            <hr className="short" />

            <h3>
              <img src={`${baseUrl}images/icon-layers.svg`} />New layers
            </h3>
            <p>
              deck.gl-community modules offer new advanced deck.gl layer types, basemap integrations and other 
              useful components.
            </p>

            <h3>
              <img src={`${baseUrl}images/icon-layers.svg`} />New use cases
            </h3>
            <p>
              Beyond geospatial, into graphs, biology etc.
            </p>

            <h3>
              <img src={`${baseUrl}images/icon-react.svg`} />React Friendly
            </h3>
            <p>

            </p>

          </div>
        </div>
      </Home>
    </Layout>
  );
}
