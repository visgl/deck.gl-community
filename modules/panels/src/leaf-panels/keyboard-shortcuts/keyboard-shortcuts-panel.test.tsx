/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';
import {render} from 'preact';

import {KeyboardShortcutsPanel} from './keyboard-shortcuts-panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('KeyboardShortcutsPanel', () => {
  it('renders paired and single shortcut rows with section grouping and badge de-duplication', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new KeyboardShortcutsPanel({
      keyboardShortcuts: [
        {
          key: 'a',
          name: 'Pan Left',
          description: 'Pan left.',
          badges: ['map'],
          displayPair: {
            id: 'pan-horizontal',
            position: 'primary',
            description: 'Pan horizontally.'
          }
        },
        {
          key: 'd',
          name: 'Pan Right',
          description: 'Pan right.',
          badges: ['map'],
          displayPair: {
            id: 'pan-horizontal',
            position: 'secondary',
            description: 'Pan horizontally.'
          }
        },
        {
          key: 'g',
          name: 'Jump',
          description: 'Jump to the selected item.'
        },
        {
          key: 'c',
          name: 'Next color scheme',
          description: 'Cycle to the next color scheme.',
          displayPair: {
            id: 'color',
            position: 'primary',
            description: 'Cycle to next or previous color scheme.'
          }
        },
        {
          key: 'c',
          shiftKey: true,
          name: 'Previous color scheme',
          description: 'Cycle to the previous color scheme.',
          displayPair: {
            id: 'color',
            position: 'secondary',
            description: 'Cycle to next or previous color scheme.'
          }
        }
      ]
    });

    render(panel.content, root);

    const sections = Array.from(root.querySelectorAll('[data-shortcut-section]'));
    expect(sections.map(section => section.getAttribute('data-shortcut-section'))).toEqual([
      'Navigation',
      'Commands',
      'Settings'
    ]);
    expect(sections[0]?.textContent).toContain('Pan horizontally.');
    expect(sections[1]?.textContent).toContain('Jump to the selected item.');
    expect(sections[2]?.textContent).toContain('Cycle to next or previous color scheme.');
    expect(root.querySelectorAll('[data-shortcut-row-kind="pair"]')).toHaveLength(2);
    expect(root.querySelectorAll('[data-shortcut-row-kind="single"]')).toHaveLength(1);
    expect(root.textContent?.match(/map/g)).toHaveLength(1);
  });

  it('renders display-only mouse and trackpad interactions in explicit sections', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new KeyboardShortcutsPanel({
      keyboardShortcuts: [
        {
          key: '',
          name: 'Trackpad pan',
          description: 'Pan with the trackpad.',
          displaySection: 'navigation',
          displayInputs: [
            {
              kind: 'trackpad',
              label: 'two-finger swipe',
              icon: 'trackpad-pan'
            }
          ]
        },
        {
          key: '',
          name: 'Select item',
          description: 'Select an item.',
          displaySection: 'interaction',
          displayInputs: [
            {
              kind: 'mouse',
              label: 'click',
              modifiers: ['shift'],
              icon: 'mouse-drag'
            }
          ]
        }
      ]
    });

    render(panel.content, root);

    const sections = Array.from(root.querySelectorAll('[data-shortcut-section]'));
    expect(sections.map(section => section.getAttribute('data-shortcut-section'))).toEqual([
      'Navigation',
      'Interaction'
    ]);
    expect(root.querySelector('[data-shortcut-input-kind="trackpad"]')).toBeTruthy();
    expect(root.querySelector('[data-shortcut-input-kind="mouse"]')).toBeTruthy();
    expect(root.querySelector('svg[aria-label="Trackpad pan"]')).toBeTruthy();
    expect(root.textContent).toContain('two-finger swipe');
    expect(root.textContent).toContain('Shift');
  });
});
