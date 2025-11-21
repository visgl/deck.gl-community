import React from 'react';
import Layout from '@theme/Layout';
import {GalleryTiles} from '../components';
import manifest from '../data/scripting-gallery.json';

export default function GalleryPage() {
  return (
    <Layout title="Scripted Examples" description="Scripting gallery for deck.gl-community">
      <main className="container margin-vert--lg">
        <h1>Scripted Examples</h1>
        <p className="margin-bottom--lg">
          Browse standalone scripting demos built without a framework bundle. Each tile links to a static HTML
          page served from the gallery build output.
        </p>

        <GalleryTiles demos={manifest} />
      </main>
    </Layout>
  );
}

