import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TraceProcessCard} from './trace-process-card';

import type {TraceProcessInfo} from '../../../../trace/index';
import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceProcessCard', () => {
  afterEach(() => {
    flushSync(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  it('invokes the node-open callback with process info when the node label is clicked', () => {
    const onOpenNode = vi.fn();
    const processInfo: TraceProcessInfo = {
      processId: '5100',
      node_name: 'node-a',
      colo: 3
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceProcessCard
          processId="RankId(5100)"
          rankNum={5100}
          processName="RankId(5100)"
          processInfo={processInfo}
          labels={{processLabel: 'Rank', spanLabel: 'Block', threadLabel: 'Stream'}}
          onOpenNode={onOpenNode}
        />
      );
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('node-a');

    flushSync(() => {
      button?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });

    expect(onOpenNode).toHaveBeenCalledWith('RankId(5100)', processInfo);
  });
});
