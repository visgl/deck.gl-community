import {TraceLabels} from '../../../../trace/index';

import type {TraceThread} from '../../../../trace/index';

export type TraceThreadCardProps = {
  stream: TraceThread;
  processName?: string;
  labels?: TraceLabels;
};

/** Renders a card for a stream object */
export function TraceThreadCard({stream, processName, labels}: TraceThreadCardProps) {
  const processLabel = labels?.processLabel?.trim() || 'Process';
  const threadLabel = labels?.threadLabel?.trim() || 'Thread';
  const processLabelUpper = processLabel.toUpperCase();
  const threadLabelUpper = threadLabel.toUpperCase();
  const processId = stream.processId || '?';
  const displayRankName = processName?.trim() ? processName : processId;
  const streamName = stream.name;

  // TODO - hack this assumes we understand the structure of application ids
  const threadIds = stream.threadId.split(':');
  const trimmedStreamId = threadIds[threadIds.length - 1]; // Get the last element of the array

  return (
    <div className="px-3 py-2 space-y-2 min-w-[400px] max-w-[500px] bg-muted-background text-foreground text-narrow ">
      <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
        <div>{threadLabelUpper} / </div>
        <div>
          {processLabelUpper} {displayRankName} /{' '}
        </div>
        <div>{streamName}</div>
        <div className="text-xs py-1 font-normal">
          {trimmedStreamId} ({processId})
        </div>
      </div>
    </div>
  );
}
