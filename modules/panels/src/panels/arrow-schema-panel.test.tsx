/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {ArrowSchemaPanel} from './arrow-schema-panel';

import type {ArrowSchemaLike} from './arrow-schema-panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ArrowSchemaPanel', () => {
  it('creates a panel with the expected id, title, theme, and content', () => {
    const panel = new ArrowSchemaPanel({
      id: 'arrow-schema',
      title: 'Arrow Schema',
      schema: createSchema(),
      theme: 'dark'
    });

    expect(panel.id).toBe('arrow-schema');
    expect(panel.title).toBe('Arrow Schema');
    expect(panel.theme).toBe('dark');
    expect(panel.content).toBeDefined();
  });

  it('renders one table row per schema field', () => {
    const root = renderPanel(createSchema());

    expect(root.textContent).toContain('Arrow Schema');
    expect(root.textContent).toContain('Name');
    expect(root.textContent).toContain('Type');
    expect(root.textContent).toContain('Nullable');
    expect(root.textContent).toContain('Metadata');
    expect(root.textContent).toContain('id');
    expect(root.textContent).toContain('Utf8');
    expect(root.textContent).toContain('count');
    expect(root.textContent).toContain('Int32');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('uses fallback labels for anonymous fields and unknown types', () => {
    const root = renderPanel({fields: [{}]});

    expect(root.textContent).toContain('field_0');
    expect(root.textContent).toContain('unknown');
  });

  it('renders schema and field metadata with JSON values parsed', () => {
    const root = renderPanel({
      metadata: new Map([
        ['geo', '{"primaryColumn":"geometry"}'],
        ['source', 'stations']
      ]),
      fields: [
        {
          name: 'geometry',
          type: 'Binary',
          metadata: new Map([
            ['encoding', '{"format":"geoarrow.wkb","edges":"planar"}'],
            ['nullableReason', 'optional geometry']
          ])
        }
      ]
    });

    expect(root.querySelector('[data-arrow-schema-metadata]')?.textContent).toContain('geo');
    expect(root.textContent).toContain('"primaryColumn": "geometry"');
    expect(root.textContent).toContain('source');
    expect(root.textContent).toContain('stations');
    expect(root.textContent).toContain('encoding');
    expect(root.textContent).toContain('"format": "geoarrow.wkb"');
    expect(root.textContent).toContain('"edges": "planar"');
    expect(root.textContent).toContain('nullableReason');
    expect(root.textContent).toContain('optional geometry');
  });

  it('renders an empty schema when no schema is supplied', () => {
    const root = renderPanel(null);

    expect(root.textContent).toContain('Arrow Schema');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});

function renderPanel(schema: ArrowSchemaLike | null): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    new ArrowSchemaPanel({
      id: 'arrow-schema',
      title: 'Arrow Schema',
      schema
    }).content,
    root
  );
  return root;
}

function createSchema(): ArrowSchemaLike {
  return {
    fields: [
      {name: 'id', type: {toString: () => 'Utf8'}, nullable: false},
      {name: 'count', type: 'Int32', nullable: true}
    ]
  };
}
