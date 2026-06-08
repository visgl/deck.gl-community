import {truncateMiddle, wrapText} from '../../trace/index';
import {getTraceSpanBadgePresentation} from '../utils/trace-span-badge-presentation';
import {CopyShortcutHint} from './copy-shortcut-hint';
import {Badge, cn} from './ui';
import {WithTooltip} from './with-tooltip';

import type {TraceLabels, TraceSpanFilterMask} from '../../trace/index';
import type {TraceSpanBadgeFilteredVariant} from '../utils/trace-span-badge-presentation';
import type {CSSProperties, MouseEvent as ReactMouseEvent, ReactNode} from 'react';

export type TraceSpanBadgeProps = {
  traceLabels: TraceLabels;
  label: ReactNode;
  interactive?: boolean;
  /** Whether the badge represents a filtered span. */
  filtered?: boolean;
  /** Visual treatment for a filtered badge. */
  filteredVariant?: TraceSpanBadgeFilteredVariant;
  /** Exact graph filter provenance used to explain filtered badges. */
  filterMask?: TraceSpanFilterMask | null;
  onClick?: () => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  maxLabelLength?: number;
  className?: string;
  style?: CSSProperties;
  /** Base tooltip used when `tooltipText` is not supplied. */
  baseTooltipText?: string;
  /** Final tooltip text. When supplied, it is not rewritten by filter presentation logic. */
  tooltipText?: string;
  /** Text copied when the badge tooltip is open and the user presses Cmd/Ctrl-C. */
  copyText?: string;
  /** Optional action hint shown in copyable badge tooltips. */
  copyHint?: ReactNode;
  showRank?: boolean;
  blockRank?: number | null;
  currentRank?: number | null;
};

export function TraceSpanBadge(props: TraceSpanBadgeProps) {
  const {
    label,
    className,
    style,
    interactive,
    onClick,
    onDoubleClick,
    showRank,
    blockRank,
    currentRank,
    maxLabelLength = 40,
    tooltipText
  } = props;
  const processLabel = props.traceLabels.processLabel.trim();
  const labelText =
    typeof label === 'string' || typeof label === 'number' ? String(label) : undefined;
  const presentation = labelText
    ? getTraceSpanBadgePresentation({
        label: labelText,
        tooltipText: props.baseTooltipText ?? labelText,
        filtered: props.filtered,
        filteredVariant: props.filteredVariant,
        filterMask: props.filterMask,
        maxLabelLength,
        ellipsisPosition: 5,
        backgroundColor: typeof style?.backgroundColor === 'string' ? style.backgroundColor : null,
        textColor: typeof style?.color === 'string' ? style.color : null
      })
    : null;
  const truncatedLabel = presentation?.truncatedLabel ?? label;
  const tooltip = tooltipText ?? presentation?.tooltipText ?? props.baseTooltipText ?? labelText;
  const copyHint = props.copyText
    ? (props.copyHint ?? renderTraceSpanBadgeShortcutHint())
    : undefined;

  const shouldShowRank =
    Boolean(showRank) &&
    typeof blockRank === 'number' &&
    (typeof currentRank !== 'number' || blockRank !== currentRank);

  const isFiltered = presentation?.isFiltered ?? Boolean(props.filtered);
  const filteredVariant = presentation?.filteredVariant ?? props.filteredVariant ?? 'regexp';
  const filteredBadgeClassName = isFiltered
    ? filteredVariant === 'topology'
      ? 'border text-muted-foreground bg-background'
      : 'border border-muted-foreground text-muted-foreground bg-background'
    : null;
  const filteredContentClassName = isFiltered ? 'text-muted-foreground' : null;
  const badgeStyle = isFiltered
    ? {
        ...style,
        backgroundColor: presentation?.badgeBackgroundColor,
        borderColor: presentation?.badgeBorderColor
      }
    : style;
  const contentStyle = isFiltered
    ? presentation?.badgeTextColor
      ? {color: presentation.badgeTextColor}
      : undefined
    : style?.color
      ? {color: style.color}
      : undefined;
  const labelElement = interactive ? (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={contentStyle}
      className={cn('select-none whitespace-nowrap w-full text-left', filteredContentClassName)}
    >
      {truncatedLabel}
    </button>
  ) : (
    <span
      className={cn('select-none whitespace-nowrap', filteredContentClassName)}
      style={contentStyle}
    >
      {truncatedLabel}
    </span>
  );

  const badge = (
    <Badge
      className={cn(
        'relative group inline-flex min-w-0 items-center whitespace-nowrap',
        'select-none',
        filteredBadgeClassName,
        className
      )}
      style={badgeStyle}
    >
      {labelElement}
      {shouldShowRank ? (
        <span className="pointer-events-none absolute -top-1 -right-1 inline-flex h-4 min-w-[1.05rem] items-center justify-center rounded-full bg-black/50 px-1 text-[10px] font-semibold leading-4 text-white shadow-sm duration-150 group-hover:opacity-30 transition-opacity">
          <span className="hidden group-hover:inline mr-1">{processLabel}</span> {blockRank}
        </span>
      ) : null}
    </Badge>
  );

  return tooltip ? (
    <WithTooltip tooltip={renderTraceSpanBadgeTooltip(tooltip, copyHint)} copyText={props.copyText}>
      <span>{badge}</span>
    </WithTooltip>
  ) : (
    badge
  );
}

/**
 * Builds a bounded tooltip node so very large span names stay readable in overlays.
 */
function renderTraceSpanBadgeTooltip(tooltip: string, copyHint?: ReactNode): ReactNode {
  const boundedTooltip = truncateMiddle(tooltip, {
    maxLabelLength: 480,
    ellipsisPosition: 240
  });
  return (
    <div className="flex min-w-44 max-w-[22rem] flex-col text-left">
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {wrapText(boundedTooltip, {maxLineLength: 64})}
      </div>
      {copyHint}
    </div>
  );
}

/**
 * Renders compact action hints for copyable span badges using shared shortcut formatting.
 */
function renderTraceSpanBadgeShortcutHint(): ReactNode {
  return <CopyShortcutHint className="mt-1 justify-end text-[11px] opacity-80" />;
}
