import * as React from 'react';
import {render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';

import {MarkdownPanel} from '../../../panels/src';

import {WidgetPanel} from './widget-panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WidgetPanel', () => {
  it('renders a single widget panel inside a React tree', () => {
    render(
      <WidgetPanel
        panel={
          new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Rendered from React'
          })
        }
      />
    );

    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Rendered from React')).toBeTruthy();
  });

  it('renders a full widget container when provided', () => {
    render(
      <WidgetPanel
        container={{
          kind: 'tabs',
          props: {
            panels: [
              new MarkdownPanel({
                id: 'first',
                title: 'First',
                markdown: 'First tab'
              }),
              new MarkdownPanel({
                id: 'second',
                title: 'Second',
                markdown: 'Second tab'
              })
            ]
          }
        }}
      />
    );

    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText('First tab')).toBeTruthy();
  });

  it('applies a dark theme host when requested', () => {
    const {container} = render(
      <WidgetPanel
        themeMode="dark"
        panel={
          new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Dark host'
          })
        }
      />
    );

    const host = container.querySelector<HTMLDivElement>('.deck-react-widget-panel');
    expect(host?.style.getPropertyValue('--menu-background')).toContain('rgba');
  });

  it('supports unframed rendering for embedded layouts', () => {
    const {container} = render(
      <WidgetPanel
        framed={false}
        panel={
          new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Unframed content'
          })
        }
      />
    );

    const host = container.querySelector<HTMLDivElement>('.deck-react-widget-panel');
    expect(host?.style.border).toBe('');
    expect(screen.getByText('Unframed content')).toBeTruthy();
  });
});
