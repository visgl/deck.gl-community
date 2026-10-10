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
  const loadButton = root.querySelector('button')!;
  expect(loadButton.disabled).toBe(true);
  expect(Number(getComputedStyle(loadButton).opacity)).toBeLessThan(1);
  const select = root.querySelector('select')!;
  select.value = 'earth';
  select.dispatchEvent(new Event('change', {bubbles: true}));
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLInputElement>('input[type=url]')!.value).toBe(
      'https://example.test/catalog.json'
    )
  );
  expect(loadButton.disabled).toBe(false);
  expect(getComputedStyle(loadButton).opacity).toBe('1');
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
  const enabledDragOver = new DragEvent('dragover', {
    dataTransfer: dropTransfer,
    bubbles: true,
    cancelable: true
  });
  root.firstElementChild!.dispatchEvent(enabledDragOver);
  expect(enabledDragOver.defaultPrevented).toBe(true);
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
  const disabledDragOver = new DragEvent('dragover', {
    dataTransfer: dropTransfer,
    bubbles: true,
    cancelable: true
  });
  root.firstElementChild!.dispatchEvent(disabledDragOver);
  expect(disabledDragOver.defaultPrevented).toBe(false);
  root.firstElementChild!.dispatchEvent(
    new DragEvent('drop', {dataTransfer: dropTransfer, bubbles: true, cancelable: true})
  );
  expect(onSelectFiles).toHaveBeenCalledTimes(2);
  for (const control of root.querySelectorAll('input, select, button')) {
    expect(Number(getComputedStyle(control).opacity)).toBeLessThan(1);
  }
});

test.each(['text/plain', 'text/uri-list'])('preserves native URL drops for %s', type => {
  const onSelectFiles = vi.fn();
  mountPanel(
    new SourcePickerPanel({
      id: 'text-drop',
      title: 'Source',
      onLoadUrl: vi.fn(),
      onSelectFiles
    })
  );
  const transfer = new DataTransfer();
  transfer.setData(type, 'https://example.test/source.json');
  const input = root.querySelector<HTMLInputElement>('input[type=url]')!;
  for (const eventType of ['dragover', 'drop']) {
    const event = new DragEvent(eventType, {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(onSelectFiles).not.toHaveBeenCalled();
});

test('file-only mode hides URL entry and presets while retaining file selection', () => {
  mountPanel(
    new SourcePickerPanel({
      id: 'files-only',
      title: 'Files',
      showUrlInput: false,
      presets: [{id: 'hidden', label: 'Hidden', url: 'https://example.test'}],
      onLoadUrl: vi.fn(),
      onSelectFiles: vi.fn()
    })
  );
  expect(root.querySelector('form')).toBeNull();
  expect(root.querySelector('select')).toBeNull();
  expect(root.querySelector('input[type=file]')).not.toBeNull();
});
