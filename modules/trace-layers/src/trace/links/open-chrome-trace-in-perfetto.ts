/**
 * Opens a Chrome trace in Perfetto
 * @param runId - Optional ID of the run containing the trace (used by fetchTrace implementations)
 * @param traceId - The ID of the trace to open
 * @param arrayBuffer - Optional pre-fetched trace buffer. When provided, avoids fetching from the API.
 * @param title - Optional title to show in Perfetto
 * @param fetchTrace - Optional function to fetch the trace when a buffer is not provided
 * @param reopenUrl - Optional URL for reopening the trace. If a buffer is provided, an object URL is generated.
 * @returns Promise<void>
 * @todo - Move to a shared trace link helper?
 */
export async function openChromeTraceInPerfetto({
  runId,
  traceId,
  arrayBuffer,
  title,
  mode = 'tab',
  fetchTrace,
  reopenUrl: reopenUrlOverride
}: {
  runId?: string | null;
  traceId: string;
  arrayBuffer?: ArrayBuffer;
  title?: string;
  /** Whether to open Perfetto in a popup window or a browser tab. */
  mode?: 'popup' | 'tab';
  fetchTrace?: (args: {runId?: string | null; traceId: string}) => Promise<ArrayBuffer>;
  reopenUrl?: string;
}) {
  try {
    let traceBuffer = arrayBuffer;
    let reopenUrl = reopenUrlOverride;

    if (!traceBuffer) {
      if (!fetchTrace) {
        console.error('Missing fetchTrace for Perfetto trace fetch');
        return;
      }
      traceBuffer = await fetchTrace({runId, traceId});
    } else if (!reopenUrl) {
      const blob = new Blob([traceBuffer], {type: 'application/json'});
      reopenUrl = URL.createObjectURL(blob);
    }

    const perfettoWindow =
      mode === 'popup'
        ? window.open('https://ui.perfetto.dev', '_blank', 'width=1200,height=600')
        : window.open('https://ui.perfetto.dev', '_blank');
    if (!perfettoWindow) {
      console.error('Failed to open Perfetto window');
      return;
    }
    const ORIGIN = 'https://ui.perfetto.dev';
    const timer = setInterval(() => perfettoWindow.postMessage('PING', ORIGIN), 50);

    const onMessage = (evt: MessageEvent) => {
      if (evt.origin !== ORIGIN || evt.data !== 'PONG') return;
      clearInterval(timer);
      window.removeEventListener('message', onMessage);

      perfettoWindow.postMessage(
        {
          perfetto: {
            buffer: traceBuffer,
            title: title ?? 'Trace Viewer',
            url: reopenUrl
          }
        },
        ORIGIN
      );
    };
    window.addEventListener('message', onMessage);
  } catch (e) {
    console.error('Failed to load trace into perfetto window', e);
  }
}
