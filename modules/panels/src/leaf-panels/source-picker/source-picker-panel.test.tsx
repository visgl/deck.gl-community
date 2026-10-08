/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, expect, test, vi} from 'vitest';
import {SourcePickerPanel} from './source-picker-panel';

let root: HTMLDivElement;
afterEach(() => {
  if (root) render(null, root);
  document.body.innerHTML = '';
});
/** Mounts a panel's content for DOM interaction. */
function mountPanel(panel: SourcePickerPanel): void {
  root = document.createElement('div');
  document.body.append(root);
  render(panel.content, root);
}

test('preset and manual edits update an uncontrolled URL without loading until submit', async () => {
  const onLoadUrl = vi.fn();
  const onUrlChange = vi.fn();
  mountPanel(
    new SourcePickerPanel({
      id: 'source',
      title: 'Source',
      presets: [{id: 'earth', label: 'Earth', url: 'https://example.test/catalog.json'}],
      onLoadUrl,
      onUrlChange
    })
  );
  const select = root.querySelector('select')!;
  select.value = 'earth';
  select.dispatchEvent(new Event('change', {bubbles: true}));
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLInputElement>('input[type=url]')!.value).toBe(
      'https://example.test/catalog.json'
    )
  );
  expect(onLoadUrl).not.toHaveBeenCalled();
  root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  expect(onLoadUrl).toHaveBeenCalledWith('https://example.test/catalog.json');
  const input = root.querySelector<HTMLInputElement>('input[type=url]')!;
  input.value = 'https://example.test/custom';
  input.dispatchEvent(new Event('input', {bubbles: true}));
  await vi.waitFor(() => expect(select.value).toBe(''));
  expect(onUrlChange).toHaveBeenLastCalledWith('https://example.test/custom');
});

test('controlled URLs remain host-owned and disabled sources do not submit', () => {
  const onLoadUrl = vi.fn();
  const onUrlChange = vi.fn();
  mountPanel(
    new SourcePickerPanel({
      id: 'controlled',
      title: 'Source',
      url: 'https://example.test/original',
      onLoadUrl,
      onUrlChange
    })
  );
  const input = root.querySelector<HTMLInputElement>('input[type=url]')!;
  input.value = 'https://example.test/edit';
  input.dispatchEvent(new Event('input', {bubbles: true}));
  root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  expect(onUrlChange).toHaveBeenCalledWith('https://example.test/edit');
  expect(onLoadUrl).toHaveBeenCalledWith('https://example.test/original');
  render(
    new SourcePickerPanel({
      id: 'disabled',
      title: 'Source',
      url: 'https://example.test/new',
      disabled: true,
      onLoadUrl
    }).content,
    root
  );
  root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  expect(onLoadUrl).toHaveBeenCalledTimes(1);
  expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
});

test('file input and drops pass files through, enforce single selection, and respect disabled state', () => {
  const onSelectFiles = vi.fn();
  const first = new File(['a'], 'first.json');
  const second = new File(['b'], 'second.json');
  const transfer = new DataTransfer();
  transfer.items.add(first);
  transfer.items.add(second);
  mountPanel(
    new SourcePickerPanel({
      id: 'files',
      title: 'Source',
      onLoadUrl: vi.fn(),
      onSelectFiles,
      accept: '.json'
    })
  );
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', {bubbles: true}));
  expect(onSelectFiles).toHaveBeenLastCalledWith([first]);
  expect(input.value).toBe('');
  const dropTransfer = new DataTransfer();
  dropTransfer.items.add(first);
  dropTransfer.items.add(second);
  render(
    new SourcePickerPanel({
      id: 'files',
      title: 'Source',
      onLoadUrl: vi.fn(),
      onSelectFiles,
      multiple: true
    }).content,
    root
  );
  root.firstElementChild!.dispatchEvent(
    new DragEvent('drop', {dataTransfer: dropTransfer, bubbles: true, cancelable: true})
  );
  expect(onSelectFiles).toHaveBeenLastCalledWith([first, second]);
  render(
    new SourcePickerPanel({
      id: 'files',
      title: 'Source',
      onLoadUrl: vi.fn(),
      onSelectFiles,
      disabled: true
    }).content,
    root
  );
  root.firstElementChild!.dispatchEvent(
    new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true})
  );
  expect(onSelectFiles).toHaveBeenCalledTimes(2);
});
