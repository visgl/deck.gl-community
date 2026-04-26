/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {BinaryDataPanel} from './binary-data-panel';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BinaryDataPanel', () => {
  it('creates a widget panel with the expected id, title, theme, and content', () => {
    const panel = new BinaryDataPanel({
      id: 'binary-data',
      title: 'Binary Data',
      data: new Uint8Array([0x41, 0x42]),
      theme: 'dark'
    });

    expect(panel.id).toBe('binary-data');
    expect(panel.title).toBe('Binary Data');
    expect(panel.theme).toBe('dark');
    expect(panel.content).toBeDefined();
  });

  it('renders ArrayBuffer input as hex and printable ASCII', () => {
    const root = renderPanel(new ArrayBuffer(4));
    const bytes = root.querySelectorAll('[data-binary-ascii-byte]');

    expect(root.textContent).toContain('0000');
    expect(root.textContent).toContain('00');
    expect(bytes).toHaveLength(4);
  });

  it('renders Uint8Array input without copying unrelated bytes', () => {
    const data = new Uint8Array([0x00, 0x41, 0x42, 0x43, 0x44]).subarray(1, 4);
    const root = renderPanel(data);

    expect(root.textContent).toContain('41');
    expect(root.textContent).toContain('42');
    expect(root.textContent).toContain('43');
    expect(root.textContent).toContain('A');
    expect(root.textContent).toContain('B');
    expect(root.textContent).toContain('C');
    expect(root.textContent).not.toContain('44');
  });

  it('renders DataView input', () => {
    const bytes = new Uint8Array([0x51, 0x52, 0x53, 0x54]);
    const root = renderPanel(new DataView(bytes.buffer, 1, 2));

    expect(root.textContent).toContain('52');
    expect(root.textContent).toContain('53');
    expect(root.textContent).toContain('R');
    expect(root.textContent).toContain('S');
    expect(root.textContent).not.toContain('51');
    expect(root.textContent).not.toContain('54');
  });

  it('applies byteOffset and byteLength before rendering', () => {
    const root = renderPanel(new Uint8Array([0x41, 0x42, 0x43, 0x44]), {
      byteOffset: 1,
      byteLength: 2
    });

    expect(root.textContent).toContain('0001');
    expect(root.textContent).toContain('42');
    expect(root.textContent).toContain('43');
    expect(root.textContent).not.toContain('41');
    expect(root.textContent).not.toContain('44');
  });

  it('uses custom row byte length', () => {
    const root = renderPanel(new Uint8Array([0x41, 0x42, 0x43, 0x44]), {
      rowByteLength: 2
    });
    const rows = root.querySelectorAll('[data-binary-data-row]');

    expect(rows).toHaveLength(2);
    expect(root.textContent).toContain('0000');
    expect(root.textContent).toContain('0002');
  });

  it('omits ASCII characters when showAscii is false', () => {
    const root = renderPanel(new Uint8Array([0x41]), {showAscii: false});

    expect(root.textContent).toContain('41');
    expect(root.textContent).not.toContain('A');
    expect(root.querySelector('[data-binary-ascii-byte]')).toBeNull();
  });

  it('leaves non-printable ASCII bytes blank', () => {
    const root = renderPanel(new Uint8Array([0x1f, 0x20, 0x7e, 0x7f]));
    const asciiBytes = [...root.querySelectorAll('[data-binary-ascii-byte]')];

    expect(asciiBytes.map(element => element.textContent)).toEqual(['', ' ', '~', '']);
  });

  it('shows a byte summary when preview bytes are capped', () => {
    const root = renderPanel(new Uint8Array([0x41, 0x42, 0x43, 0x44]), {
      maxByteLength: 2
    });

    expect(root.textContent).toContain('2 bytes included, 2 bytes omitted');
    expect(root.textContent).toContain('41');
    expect(root.textContent).toContain('42');
    expect(root.textContent).not.toContain('43');
    expect(root.textContent).not.toContain('44');
  });

  it('defaults maxByteLength to 10,000 bytes', () => {
    const data = new Uint8Array(10_001);
    const root = renderPanel(data);
    const summary = root.querySelector('[data-binary-byte-summary]');

    expect(summary?.textContent).toContain('10,000 bytes included, 1 byte omitted');
  });
});

function renderPanel(
  data: ArrayBuffer | ArrayBufferView,
  props: Partial<ConstructorParameters<typeof BinaryDataPanel>[0]> = {}
): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    new BinaryDataPanel({
      id: 'binary',
      title: 'Binary',
      data,
      ...props
    }).content,
    root
  );
  return root;
}
