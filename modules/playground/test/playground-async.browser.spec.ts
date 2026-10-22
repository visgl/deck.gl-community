// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Playground, type PlaygroundProps, type PlaygroundUpdateContext} from '../src/playground';

const PLAYGROUNDS: Playground[] = [];
const HOSTS: HTMLElement[] = [];

/** Mounts an isolated text playground without a GPU or external fixtures. */
function mountPlayground(props: Partial<PlaygroundProps> = {}): Playground {
  const parentElement = document.createElement('div');
  Object.assign(parentElement.style, {width: '900px', height: '500px'});
  document.body.append(parentElement);
  HOSTS.push(parentElement);
  const playground = new Playground({
    parentElement,
    templates: {first: 'first', second: 'second'},
    language: 'plaintext',
    parse: text => text,
    ...props
  });
  PLAYGROUNDS.push(playground);
  return playground;
}

/** Creates independently settled requests that commit only while their scope is active. */
function createPendingRenderer() {
  const requests: {
    context: PlaygroundUpdateContext;
    resolve: () => void;
    reject: (error: unknown) => void;
  }[] = [];
  const update = vi.fn(
    (root: HTMLDivElement, value: unknown, _text?: string, context?: PlaygroundUpdateContext) => {
      if (!context) throw new Error('Expected update context');
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const pending = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      requests.push({context, resolve, reject});
      return pending.then(() => {
        if (!context.signal.aborted) root.textContent = String(value);
      });
    }
  );
  return {renderer: {update, finalize: vi.fn()}, requests};
}

afterEach(() => {
  for (const playground of PLAYGROUNDS.splice(0)) playground.finalize();
  for (const host of HOSTS.splice(0)) host.remove();
});

describe('Playground template context', () => {
  it('notifies selection before rendering, but not for ordinary edits', () => {
    const events: string[] = [];
    const contexts: PlaygroundUpdateContext[] = [];
    const playground = mountPlayground({
      onTemplateChange: name => events.push(`select:${name}`),
      renderer: {
        update: (_root, value, _text, context) => {
          if (!context) throw new Error('Expected update context');
          contexts.push(context);
          events.push(`render:${String(value)}`);
        },
        finalize() {}
      }
    });
    playground.setText('edited');
    playground.setTemplate('second');
    expect(events).toEqual([
      'select:first',
      'render:first',
      'render:edited',
      'select:second',
      'render:second'
    ]);
    expect(contexts.map(context => context.templateId)).toEqual(['first', 'first', 'second']);
    expect(contexts.map(context => context.revision)).toEqual([1, 2, 3]);
    expect(contexts.map(context => context.signal.aborted)).toEqual([true, true, false]);
    playground.setTemplates({replacement: 'new'});
    expect(events.slice(-2)).toEqual(['select:replacement', 'render:new']);
  });

  it('reports built-in picker selections, including documents with identical text', () => {
    const onTemplateChange = vi.fn();
    const renderer = createPendingRenderer();
    const playground = mountPlayground({
      templates: {first: 'same', second: 'same'},
      renderer: renderer.renderer,
      onTemplateChange
    });
    playground.parentElement.querySelector<HTMLButtonElement>('[data-template="second"]')!.click();
    expect(onTemplateChange.mock.calls).toEqual([['first'], ['second']]);
    expect(renderer.requests[1].context.templateId).toBe('second');
    expect(renderer.requests[0].context.signal.aborted).toBe(true);
  });

  it('snapshots resolved metadata without injecting it into the document', () => {
    const contexts: PlaygroundUpdateContext[] = [];
    const documents: unknown[] = [];
    const metadata = {title: 'Override', screencap: '/first.png'};
    const playground = mountPlayground({
      templates: {first: {name: 'Named', metadata: {description: 'Details'}, value: 1}},
      parse: JSON.parse,
      templateMetadata: {first: metadata},
      renderer: {
        update: (_root, value, _text, context) => {
          if (!context) throw new Error('Expected update context');
          contexts.push(context);
          documents.push(value);
        },
        finalize() {}
      }
    });
    expect(documents).toEqual([{name: 'Named', value: 1}]);
    expect(contexts[0].templateMetadata).toEqual({
      title: 'Override',
      description: 'Details',
      screencap: '/first.png'
    });
    metadata.title = 'Changed';
    playground.setText('{}');
    expect(contexts[0].templateMetadata.title).toBe('Override');
    expect(contexts[1].templateMetadata.title).toBe('Changed');
  });

  it('keeps unknown template selections from disturbing the active request', () => {
    const {renderer, requests} = createPendingRenderer();
    const onTemplateChange = vi.fn();
    const playground = mountPlayground({renderer, onTemplateChange});
    expect(() => playground.setTemplate('missing')).toThrow('Unknown playground template');
    expect(requests[0].context.signal.aborted).toBe(false);
    expect(onTemplateChange).toHaveBeenCalledOnce();
  });
});

describe('Playground asynchronous renderer', () => {
  it('waits for acceptance and publishes accessible loading state', async () => {
    const {renderer, requests} = createPendingRenderer();
    const onChange = vi.fn();
    const onStatusChange = vi.fn();
    const playground = mountPlayground({renderer, onChange, onStatusChange});
    expect(onChange).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenLastCalledWith('loading', requests[0].context);
    expect(playground.previewElement.getAttribute('aria-busy')).toBe('true');
    requests[0].resolve();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('first', 'first'));
    expect(onStatusChange).toHaveBeenLastCalledWith('ready', requests[0].context);
    expect(playground.previewElement.getAttribute('aria-busy')).toBe('false');
    expect(playground.previewElement.textContent).toBe('first');
  });

  it('ignores out-of-order success and rejection without clearing the latest busy state', async () => {
    const {renderer, requests} = createPendingRenderer();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const playground = mountPlayground({renderer, onChange, onError, onStatusChange});
    playground.setText('older');
    playground.setText('newest');
    requests[0].resolve();
    requests[1].reject(new Error('Obsolete failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      'loading',
      'loading',
      'loading'
    ]);
    expect(playground.previewElement.getAttribute('aria-busy')).toBe('true');
    requests[2].resolve();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('newest', 'newest'));
    expect(playground.previewElement.textContent).toBe('newest');
  });

  it('retains the accepted preview on rejection and recovers with a later edit', async () => {
    const {renderer, requests} = createPendingRenderer();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const playground = mountPlayground({renderer, onChange, onError, onStatusChange});
    requests[0].resolve();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    playground.setText('bad');
    const failure = new Error('Compile failed');
    requests[1].reject(failure);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(failure));
    expect(onStatusChange).toHaveBeenLastCalledWith('error', requests[1].context);
    expect(playground.previewElement.textContent).toBe('first');
    expect(playground.previewElement.getAttribute('aria-busy')).toBe('false');
    expect(onChange).toHaveBeenCalledOnce();
    playground.setText('recovered');
    requests[2].resolve();
    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith('recovered', 'recovered'));
    expect(playground.previewElement.textContent).toBe('recovered');
  });

  it('cancels pending work even when the newer text fails to parse', async () => {
    const {renderer, requests} = createPendingRenderer();
    const onError = vi.fn();
    const onChange = vi.fn();
    const onStatusChange = vi.fn();
    const playground = mountPlayground({
      templates: {first: '{}'},
      parse: JSON.parse,
      renderer,
      onError,
      onChange,
      onStatusChange
    });
    playground.setText('{');
    expect(requests[0].context.signal.aborted).toBe(true);
    expect(renderer.update).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onStatusChange.mock.calls.at(-1)?.[0]).toBe('error');
    requests[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(playground.previewElement.textContent).toBe('');
  });

  it.each([
    'resolve',
    'reject'
  ] as const)('suppresses late %s after idempotent finalization', async settle => {
    const {renderer, requests} = createPendingRenderer();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const playground = mountPlayground({renderer, onChange, onError, onStatusChange});
    playground.finalize();
    playground.finalize();
    expect(requests[0].context.signal.aborted).toBe(true);
    expect(renderer.finalize).toHaveBeenCalledOnce();
    if (settle === 'resolve') requests[0].resolve();
    else requests[0].reject(new Error('Disposed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledOnce();
    expect(playground.parentElement.children).toHaveLength(0);
  });

  it('does not render an update superseded by a reentrant abort listener', () => {
    const {renderer, requests} = createPendingRenderer();
    const playground = mountPlayground({renderer});
    requests[0].context.signal.addEventListener('abort', () => playground.setText('reentrant'));
    playground.setText('superseded');
    expect(renderer.update.mock.calls.map(([, value]) => value)).toEqual(['first', 'reentrant']);
    expect(requests[1].context.revision).toBe(3);
    expect(requests[1].context.signal.aborted).toBe(false);
  });

  it('does not render a selection superseded by its notification callback', () => {
    const {renderer, requests} = createPendingRenderer();
    const onTemplateChange = vi.fn((name: string) => {
      if (name === 'second') playground.setTemplate('first');
    });
    const playground = mountPlayground({renderer, onTemplateChange});
    playground.setTemplate('second');
    expect(renderer.update.mock.calls.map(([, value]) => value)).toEqual(['first', 'first']);
    expect(requests[1].context.templateId).toBe('first');
  });

  it('keeps synchronous acceptance synchronous and routes thrown renderer errors', () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const playground = mountPlayground({
      renderer: {
        update(root, value) {
          if (value === 'bad') throw new Error('Invalid preview');
          root.textContent = String(value);
        },
        finalize() {}
      },
      onChange,
      onError,
      onStatusChange
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('first', 'first');
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual(['ready']);
    playground.setText('bad');
    expect(onChange).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toBe('Invalid preview');
    expect(playground.previewElement.textContent).toBe('first');
  });

  it('still ignores incidental non-promise return values from void renderers', () => {
    // TypeScript permits a void callback to return a value that its caller discards.
    const update: () => void = () => 'not a promise';
    const onChange = vi.fn();
    mountPlayground({renderer: {update, finalize() {}}, onChange});
    expect(onChange).toHaveBeenCalledExactlyOnceWith('first', 'first');
  });

  it('does not accept a revision superseded by a status observer', async () => {
    const {renderer, requests} = createPendingRenderer();
    const onChange = vi.fn();
    const playground = mountPlayground({
      renderer,
      onChange,
      onStatusChange(status, context) {
        if (status === 'ready' && context.revision === 1) playground.setText('newer');
      }
    });
    requests[0].resolve();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(onChange).not.toHaveBeenCalled();
    expect(playground.previewElement.getAttribute('aria-busy')).toBe('true');
    requests[1].resolve();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('newer', 'newer'));
  });

  it('handles rejection even when update synchronously starts a newer revision', async () => {
    const onError = vi.fn();
    const onChange = vi.fn();
    const {renderer, requests} = createPendingRenderer();
    const playground = mountPlayground({renderer, onError, onChange});
    renderer.update.mockImplementationOnce(() => {
      playground.setText('newer');
      return Promise.reject(new Error('Superseded during update'));
    });
    playground.setText('older');
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(requests[0].context.signal.aborted).toBe(true);
    requests[1].resolve();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith('newer', 'newer'));
  });
});
