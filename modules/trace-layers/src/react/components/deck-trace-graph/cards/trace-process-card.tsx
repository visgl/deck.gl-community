import {TraceLabels} from '../../../../trace/index';
import {PrettyTable} from '../components/pretty-table';

import type {TraceProcessInfo} from '../../../../trace/index';

export type TraceProcessCardProps = {
  /** Stable trace process id for the selected rank/process. */
  processId: string;
  /** Numeric process rank when available from trace metadata. */
  rankNum: number;
  /** Display name for the selected rank/process. */
  processName?: string;
  /** Optional app-provided metadata for the selected trace process. */
  processInfo?: TraceProcessInfo;
  /** Labels used to adapt rank/process/thread naming in the card. */
  labels?: TraceLabels;
  /** Optional callback invoked when the user requests to open this rank's node. */
  onOpenNode?: (processId: string, processInfo?: TraceProcessInfo) => void;
};

export function TraceProcessCard({
  processId,
  rankNum,
  processName,
  processInfo,
  labels,
  onOpenNode
}: TraceProcessCardProps) {
  const processLabel = labels?.processLabel?.trim() || 'Process';
  const processLabelUpper = processLabel.toUpperCase();
  const info = {...processInfo};
  const displayRankName = processName?.trim() ? processName : processId;
  const showRankNameBadge = displayRankName !== String(rankNum);

  const {node_name, colo /* node_ip, */} = info;
  const {expert_group_idx, expert_shard_idx, op_shard_idx} = info;
  const nodeNameLabel = node_name ?? 'N/A';

  delete info.runId;
  delete info.processId;
  delete info.rank_id;
  delete info.node_name;
  delete info.node_ip;
  delete info.colo;
  delete info.expert_group_idx;
  delete info.expert_shard_idx;
  delete info.op_shard_idx;

  const infoEntries = Object.entries(info)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);
  const rows = infoEntries.reduce<(string | number)[][]>((acc, entry, index) => {
    if (index % 2 === 0) {
      acc.push([...entry]);
    } else {
      acc[acc.length - 1].push(...entry);
    }
    return acc;
  }, []);
  if (rows.length > 0 && rows[rows.length - 1].length === 2) {
    rows[rows.length - 1].push('', '');
  }

  return (
    <div className="px-3 py-2 space-y-2 min-w-[400px] max-w-[500px] bg-muted-background text-foreground text-narrow">
      <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
        <div>
          {processLabelUpper} {rankNum} /{' '}
        </div>
        {showRankNameBadge && <span className="inline-block truncate">{displayRankName} / </span>}
        <div>
          NODE{' '}
          {onOpenNode && node_name ? (
            <button
              type="button"
              className="font-bold underline underline-offset-2"
              onClick={() => onOpenNode(processId, processInfo)}
            >
              {nodeNameLabel}
            </button>
          ) : (
            nodeNameLabel
          )}{' '}
          colo {colo ?? 'N/A'}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {expert_group_idx !== undefined && expert_shard_idx !== undefined && (
          <span>
            EXPERT group {expert_group_idx} shard {expert_shard_idx}
          </span>
        )}
        {op_shard_idx !== undefined && <span>OP shard {op_shard_idx}</span>}
      </div>
      <PrettyTable rows={rows} />
    </div>
  );
}
