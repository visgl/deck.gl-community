// @vitest-environment happy-dom

import {afterEach, describe, expect, it, vi} from 'vitest';

import {openChromeTraceInPerfetto} from './open-chrome-trace-in-perfetto';

function encodeTextToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

describe('openChromeTraceInPerfetto', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a provided buffer without fetching and posts an object URL', async () => {
    const arrayBuffer = encodeTextToArrayBuffer('{"trace":true}');
    const postMessage = vi.fn();
    const perfettoWindow = {postMessage} as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(perfettoWindow);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:uploaded-trace');

    await openChromeTraceInPerfetto({
      traceId: 'uploaded-trace',
      arrayBuffer,
      title: 'Uploaded trace'
    });

    window.dispatchEvent(
      new MessageEvent('message', {data: 'PONG', origin: 'https://ui.perfetto.dev'})
    );

    const perfettoPost = postMessage.mock.calls.find(
      ([payload]) => typeof payload === 'object' && payload && 'perfetto' in (payload as object)
    );
    expect(openSpy).toHaveBeenCalledWith('https://ui.perfetto.dev', '_blank');
    expect(perfettoPost).toEqual([
      {
        perfetto: {
          buffer: arrayBuffer,
          title: 'Uploaded trace',
          url: 'blob:uploaded-trace'
        }
      },
      'https://ui.perfetto.dev'
    ]);
  });

  it('opens Perfetto in a popup window when popup mode is requested', async () => {
    const arrayBuffer = encodeTextToArrayBuffer('{"trace":true}');
    const postMessage = vi.fn();
    const perfettoWindow = {postMessage} as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(perfettoWindow);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:uploaded-trace');

    await openChromeTraceInPerfetto({
      traceId: 'uploaded-trace',
      arrayBuffer,
      mode: 'popup'
    });

    expect(openSpy).toHaveBeenCalledWith(
      'https://ui.perfetto.dev',
      '_blank',
      'width=1200,height=600'
    );
  });

  it('fetches via the provided fetchTrace callback when no buffer is provided', async () => {
    const fetchedBuffer = encodeTextToArrayBuffer('{}');
    const fetchTrace = vi.fn().mockResolvedValue(fetchedBuffer);

    const postMessage = vi.fn();
    const perfettoWindow = {postMessage} as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(perfettoWindow);

    await openChromeTraceInPerfetto({
      runId: 'run-123',
      traceId: 'trace-123',
      fetchTrace,
      reopenUrl: 'https://tracevis.example/reopen'
    });

    window.dispatchEvent(
      new MessageEvent('message', {data: 'PONG', origin: 'https://ui.perfetto.dev'})
    );

    expect(fetchTrace).toHaveBeenCalledWith({runId: 'run-123', traceId: 'trace-123'});
    const perfettoPost = postMessage.mock.calls.find(
      ([payload]) => typeof payload === 'object' && payload && 'perfetto' in (payload as object)
    );
    expect(perfettoPost).toEqual([
      {
        perfetto: expect.objectContaining({
          buffer: fetchedBuffer,
          url: 'https://tracevis.example/reopen'
        })
      },
      'https://ui.perfetto.dev'
    ]);
  });
});
