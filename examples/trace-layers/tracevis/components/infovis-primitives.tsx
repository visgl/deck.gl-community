import {useState} from 'react';
import {flexRender, getCoreRowModel, getSortedRowModel, useReactTable} from '@tanstack/react-table';
import {WithTooltip} from '@deck.gl-community/trace-layers/react';

import type {ColumnDef, OnChangeFn, RowSelectionState, SortingState} from '@tanstack/react-table';
import type {CSSProperties, HTMLAttributes, ReactNode} from 'react';

export {WithTooltip};
export type {ColumnDef, RowSelectionState};

/** Item displayed by the compact native select adapter. */
export type CompactSelectItem<TValue extends string> = {
  /** User-facing option label. */
  name?: ReactNode;
  /** Alternate user-facing option label accepted for compatibility. */
  label?: ReactNode;
  /** Value emitted when this option is selected. */
  value: TValue;
  /** Whether this option is disabled. */
  disabled?: boolean;
};

/** Props for the OSS-local compact native select adapter. */
export type CompactSelectProps<TValue extends string> = {
  /** Currently selected value. */
  value?: TValue;
  /** Placeholder shown when no value is selected. */
  placeholder?: string;
  /** Options available in the select. */
  items: readonly CompactSelectItem<TValue>[];
  /** Called after the selected value changes. */
  onValueChange: (value: TValue) => void;
  /** Whether to render a tighter control. */
  small?: boolean;
  /** Optional class name for the wrapper. */
  className?: string;
  /** Optional class name for the native select element. */
  triggerClassName?: string;
  /** Whether the select is disabled. */
  disabled?: boolean;
  /** Message shown when no options are present. */
  emptyMessage?: string;
};

/** Option displayed by the OSS-local multi-select adapter. */
export type MultiSelectOption = {
  /** User-facing option label. */
  label: ReactNode;
  /** Stable option value. */
  value: string;
  /** Whether this option is disabled. */
  disabled?: boolean;
};

/** Props for the OSS-local checkbox-backed multi-select adapter. */
export type MultiSelectProps = {
  /** Optional class name for the options container. */
  className?: string;
  /** Placeholder shown when no options are available. */
  placeholder?: string;
  /** Options available for selection. */
  options: readonly MultiSelectOption[];
  /** Currently selected values; undefined is treated as an empty selection. */
  value?: readonly string[];
  /** Called with the next selected values. */
  onValueChange: (value: string[]) => void;
};

/** Props for the OSS-local boolean switch adapter. */
export type SlidingThumbSwitchProps = {
  /** Optional DOM id for the switch button. */
  id?: string;
  /** Whether the switch is checked. */
  checked: boolean;
  /** Called after the checked state changes. */
  onCheckedChange: (checked: boolean) => void;
  /** Whether the switch is disabled. */
  disabled?: boolean;
  /** Optional class name for the switch button. */
  className?: string;
};

/** Props for the OSS-local info tooltip glyph. */
export type WithInfoProps = {
  /** Tooltip body shown when hovering the info glyph. */
  tooltip: ReactNode;
  /** Optional content to render instead of the default info glyph. */
  children?: ReactNode;
};

/** Props for the OSS-local banner used by the standalone demo panel. */
export type DismissibleBannerProps = {
  /** Banner text. */
  text: ReactNode;
  /** Optional link target. */
  href?: string;
  /** Optional class name for the banner root. */
  className?: string;
};

/** Visual treatment for the OSS-local badge adapter. */
export type DismissibleBadgeVariant = 'default' | 'destructive';

/** Props for the OSS-local badge adapter used by demo notices. */
export type DismissibleBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /** Visual treatment for the badge. */
  variant?: DismissibleBadgeVariant;
};

/** Props for the OSS-local error message adapter. */
export type ErrorMessageProps = {
  /** Error-like value to describe. */
  error: unknown;
  /** Optional resource name used as context for the error. */
  resourceName?: string;
};

/** Props for the small TanStack-backed data table adapter. */
export type DataTableProps<TData, TValue> = {
  /** Optional class name for the table wrapper. */
  className?: string;
  /** Column definitions rendered by TanStack Table. */
  columns: ColumnDef<TData, TValue>[];
  /** Rows to render. */
  data: TData[];
  /** Current row-selection state keyed by row id. */
  rowSelection?: RowSelectionState;
  /** Called after row selection changes. */
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Message shown when the table has no rows. */
  noDataMessage?: ReactNode;
};

/**
 * Renders a compact select using native browser controls.
 */
export function CompactSelect<TValue extends string>({
  value,
  placeholder,
  items,
  onValueChange,
  small,
  className,
  triggerClassName,
  disabled,
  emptyMessage = 'No options available'
}: CompactSelectProps<TValue>) {
  const hasOptions = items.length > 0;

  return (
    <span className={className}>
      <select
        className={[
          'rounded-md border border-border bg-background text-foreground shadow-sm',
          small ? 'h-8 px-2 text-xs' : 'h-9 px-3 text-sm',
          triggerClassName
        ]
          .filter(Boolean)
          .join(' ')}
        value={value ?? ''}
        disabled={disabled || !hasOptions}
        onChange={event => onValueChange(event.currentTarget.value as TValue)}
      >
        {placeholder ? (
          <option value="" disabled>
            {hasOptions ? placeholder : emptyMessage}
          </option>
        ) : null}
        {items.map(item => (
          <option key={item.value} value={item.value} disabled={item.disabled}>
            {getOptionLabel(item.name ?? item.label, item.value)}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Renders a small checkbox list with a multi-select-compatible API.
 */
export function MultiSelect({
  className,
  placeholder = 'No options available',
  options,
  value,
  onValueChange
}: MultiSelectProps) {
  const selectedValues = value ?? [];

  if (options.length === 0) {
    return <div className={className}>{placeholder}</div>;
  }

  return (
    <div className={['flex flex-wrap gap-2 text-xs', className].filter(Boolean).join(' ')}>
      {options.map(option => {
        const checked = selectedValues.includes(option.value);
        return (
          <label
            key={option.value}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1"
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={option.disabled}
              onChange={event => {
                const nextValue = event.currentTarget.checked
                  ? [...selectedValues, option.value]
                  : selectedValues.filter(selectedValue => selectedValue !== option.value);
                onValueChange(nextValue);
              }}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Renders a compact boolean switch with the previous checked-change API.
 */
export function SlidingThumbSwitch({
  id,
  checked,
  onCheckedChange,
  disabled,
  className
}: SlidingThumbSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={[
        'relative inline-flex h-5 w-9 items-center rounded-full border border-border transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        className={[
          'inline-block h-4 w-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        ]
          .filter(Boolean)
          .join(' ')}
      />
    </button>
  );
}

/**
 * Renders an inline info marker with tooltip text.
 */
export function WithInfo({tooltip, children}: WithInfoProps) {
  return (
    <WithTooltip tooltip={tooltip}>
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs text-muted-foreground">
        {children ?? 'i'}
      </span>
    </WithTooltip>
  );
}

/**
 * Renders a lightweight informational banner for the OSS demo panel.
 */
export function DismissibleBanner({text, href, className}: DismissibleBannerProps) {
  const content = (
    <span
      className={[
        'block rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {text}
    </span>
  );

  if (!href) {
    return content;
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="block">
      {content}
    </a>
  );
}

/**
 * Renders a compact status badge used by demo warnings and errors.
 */
export function DismissibleBadge({
  variant = 'default',
  className,
  children,
  ...spanProps
}: DismissibleBadgeProps) {
  const variantClassName =
    variant === 'destructive'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-border bg-muted text-foreground';

  return (
    <span
      {...spanProps}
      className={[
        'inline-flex rounded-full border px-2 py-0.5 text-xs',
        variantClassName,
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

/**
 * Renders a readable error description.
 */
export function ErrorMessage({error, resourceName}: ErrorMessageProps) {
  const message = getErrorMessage(error);
  return (
    <div className="max-w-md whitespace-pre-wrap text-xs">
      {resourceName ? `${resourceName}: ` : null}
      {message}
    </div>
  );
}

/**
 * Renders a small TanStack-backed table for OSS trace metadata lists.
 */
export function DataTable<TData, TValue>({
  className,
  columns,
  data,
  rowSelection = {},
  onRowSelectionChange,
  noDataMessage = 'No data.'
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    columns,
    data,
    enableRowSelection: Boolean(onRowSelectionChange),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onRowSelectionChange,
    onSortingChange: setSorting,
    state: {
      rowSelection,
      sorting
    }
  });

  return (
    <div
      className={['overflow-auto rounded-md border border-border', className]
        .filter(Boolean)
        .join(' ')}
    >
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted text-muted-foreground">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => {
                const headerContent = header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext());
                return (
                  <th
                    key={header.id}
                    className="border-b border-border px-3 py-2 text-left font-medium"
                    style={getColumnSizeStyle(header.column.columnDef.size)}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {headerContent}
                        <span className="text-[10px]">
                          {header.column.getIsSorted() === 'asc'
                            ? '▲'
                            : header.column.getIsSorted() === 'desc'
                              ? '▼'
                              : null}
                        </span>
                      </button>
                    ) : (
                      headerContent
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td
                className="px-3 py-6 text-center text-sm text-muted-foreground"
                colSpan={columns.length}
              >
                {noDataMessage}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map(row => (
              <tr key={row.id} className="border-b border-border last:border-b-0">
                {row.getVisibleCells().map(cell => (
                  <td
                    key={cell.id}
                    className="px-3 py-2 align-middle text-foreground"
                    style={getColumnSizeStyle(cell.column.columnDef.size)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Converts an arbitrary React option label into native option text.
 */
function getOptionLabel(label: ReactNode, fallback: string): string {
  if (typeof label === 'string' || typeof label === 'number') {
    return String(label);
  }
  return fallback;
}

/**
 * Converts a TanStack column size into an optional inline width style.
 */
function getColumnSizeStyle(size: unknown): CSSProperties | undefined {
  if (typeof size !== 'number') {
    return undefined;
  }
  return {width: `${size}px`};
}

/**
 * Extracts a stable message from unknown error-like values.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
