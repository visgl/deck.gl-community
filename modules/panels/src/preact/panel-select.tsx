/** @jsxImportSource preact */

import {createPortal} from 'preact/compat';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'preact/hooks';

import type {ComponentChildren, JSX} from 'preact';

/** Scalar values supported by the reusable panel select. */
export type PanelSelectValue = string | number | boolean;

/** Option rendered by the reusable panel select. */
export type PanelSelectOption = {
  /** User-visible option label. */
  label: string;
  /** Stable value emitted when the option is selected. */
  value: PanelSelectValue;
};

/** Props accepted by the reusable themed panel select. */
export type PanelSelectProps = {
  /** Accessible control label. */
  ariaLabel: string;
  /** Current selected value. */
  value: PanelSelectValue;
  /** Options available in the dropdown menu. */
  options: ReadonlyArray<PanelSelectOption>;
  /** Called when the selected value changes. */
  onChange: (value: PanelSelectValue) => void;
  /** Optional icon rendered at the end of the button. */
  trailingIcon?: ComponentChildren;
  /** Optional inline style applied to the outer shell. */
  style?: JSX.CSSProperties;
};

/** Option rendered by the reusable panel multi-select. */
export type PanelMultiSelectOption = {
  /** User-visible option label. */
  label: string;
  /** Stable string value toggled by the option. */
  value: string;
};

/** Props accepted by the reusable themed panel multi-select. */
export type PanelMultiSelectProps = {
  /** Accessible control label. */
  ariaLabel: string;
  /** Current selected values. */
  value: readonly string[];
  /** Options available in the dropdown menu. */
  options: ReadonlyArray<PanelMultiSelectOption>;
  /** Called when selected values change. */
  onChange: (value: string[]) => void;
  /** Text shown when no values are selected. */
  placeholder?: string;
  /** Optional icon rendered at the end of the button. */
  trailingIcon?: ComponentChildren;
  /** Optional inline style applied to the outer shell. */
  style?: JSX.CSSProperties;
};

/** Renders a deck-themed select control with a rounded custom dropdown menu. */
export function PanelSelect({
  ariaLabel,
  value,
  options,
  onChange,
  trailingIcon,
  style
}: PanelSelectProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(() =>
    findSelectedOptionIndex(options, value)
  );
  const [menuStyle, setMenuStyle] = useState<JSX.CSSProperties>(PANEL_SELECT_STYLES.menu);
  const selectedOptionIndex = useMemo(
    () => findSelectedOptionIndex(options, value),
    [options, value]
  );
  const selectedOption = selectedOptionIndex >= 0 ? options[selectedOptionIndex] : undefined;
  const listboxId = `${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-options`;

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, options.length);
  }, [options.length]);

  useEffect(() => {
    if (!open) {
      setActiveOptionIndex(selectedOptionIndex);
    }
  }, [open, selectedOptionIndex]);

  useEffect(() => {
    const ownerDocument = shellRef.current?.ownerDocument;
    if (!open || !ownerDocument) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const shell = shellRef.current;
      const listbox = listboxRef.current;
      if (
        !shell ||
        !event.target ||
        shell.contains(event.target as Node) ||
        listbox?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };

    ownerDocument.addEventListener('pointerdown', handlePointerDown);
    return () => ownerDocument.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useLayoutEffect(() => {
    const ownerDocument = shellRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!open || !shellRef.current || !ownerWindow) {
      return;
    }

    const updateMenuStyle = () => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }
      const rect = shell.getBoundingClientRect();
      setMenuStyle({
        ...PANEL_SELECT_STYLES.menu,
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`
      });
    };

    updateMenuStyle();
    ownerWindow.addEventListener('resize', updateMenuStyle);
    ownerWindow.addEventListener('scroll', updateMenuStyle, true);
    return () => {
      ownerWindow.removeEventListener('resize', updateMenuStyle);
      ownerWindow.removeEventListener('scroll', updateMenuStyle, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeOptionIndex < 0) {
      return;
    }
    optionRefs.current[activeOptionIndex]?.scrollIntoView?.({block: 'nearest'});
  }, [activeOptionIndex, open]);

  const selectOption = (option: PanelSelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const handleTriggerKeyDown: JSX.KeyboardEventHandler<HTMLButtonElement> = event => {
    stopEventPropagation(event as unknown as Event);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveOptionIndex(previous =>
        getNextOptionIndex(previous, event.key === 'ArrowDown' ? 1 : -1, options.length)
      );
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open && activeOptionIndex >= 0) {
        const option = options[activeOptionIndex];
        if (option) {
          selectOption(option);
        }
        return;
      }
      setOpen(true);
      setActiveOptionIndex(selectedOptionIndex);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div
      ref={shellRef}
      style={{...PANEL_SELECT_STYLES.shell, ...style}}
      onPointerDown={event => stopEventPropagation(event as unknown as Event)}
      onMouseDown={event => stopEventPropagation(event as unknown as Event)}
      onWheel={event => stopEventPropagation(event as unknown as Event)}
      onClick={event => stopEventPropagation(event as unknown as Event)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        style={{
          ...PANEL_SELECT_STYLES.button,
          ...(open ? PANEL_SELECT_STYLES.buttonOpen : {}),
          opacity: options.length ? 1 : 0.58,
          cursor: options.length ? 'pointer' : 'default'
        }}
        disabled={!options.length}
        onClick={() => setOpen(current => !current)}
        onKeyDown={handleTriggerKeyDown}
        onKeyUp={event => stopEventPropagation(event as unknown as Event)}
      >
        <span>{selectedOption?.label ?? String(value)}</span>
        {trailingIcon ?? <PanelSelectChevron />}
      </button>
      {open && shellRef.current?.ownerDocument.body
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label={`${ariaLabel} options`}
              style={menuStyle}
              onPointerDown={event => stopEventPropagation(event as unknown as Event)}
              onMouseDown={event => stopEventPropagation(event as unknown as Event)}
              onWheel={event => stopEventPropagation(event as unknown as Event)}
              onClick={event => stopEventPropagation(event as unknown as Event)}
            >
              {options.map((option, index) => {
                const selected = String(option.value) === String(value);
                const active = index === activeOptionIndex;
                return (
                  <button
                    key={String(option.value)}
                    ref={element => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    style={{
                      ...PANEL_SELECT_STYLES.option,
                      ...(active ? PANEL_SELECT_STYLES.optionActive : {}),
                      ...(selected ? PANEL_SELECT_STYLES.optionSelected : {})
                    }}
                    onPointerEnter={() => setActiveOptionIndex(index)}
                    onMouseDown={event => {
                      event.preventDefault();
                      stopEventPropagation(event as unknown as Event);
                    }}
                    onClick={() => selectOption(option)}
                  >
                    <span>{option.label}</span>
                    {selected ? <span aria-hidden>✓</span> : null}
                  </button>
                );
              })}
            </div>,
            shellRef.current.ownerDocument.body
          )
        : null}
    </div>
  );
}

/** Renders a deck-themed searchable string multi-select. */
export function PanelMultiSelect({
  ariaLabel,
  value,
  options,
  onChange,
  placeholder = 'All',
  trailingIcon,
  style
}: PanelMultiSelectProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<JSX.CSSProperties>(PANEL_SELECT_STYLES.menu);
  const selectedValues = useMemo(
    () => value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
    [value]
  );
  const mergedOptions = useMemo(
    () => mergeSelectedMultiSelectOptions(options, selectedValues),
    [options, selectedValues]
  );
  const selectedValueSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return mergedOptions;
    }
    return mergedOptions.filter(
      option =>
        option.label.toLowerCase().includes(normalizedQuery) ||
        option.value.toLowerCase().includes(normalizedQuery)
    );
  }, [mergedOptions, query]);
  const listboxId = `${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-options`;
  const summaryLabel = getMultiSelectSummaryLabel(selectedValues, mergedOptions, placeholder);

  useEffect(() => {
    const ownerDocument = shellRef.current?.ownerDocument;
    if (!open || !ownerDocument) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const shell = shellRef.current;
      const listbox = listboxRef.current;
      if (
        !shell ||
        !event.target ||
        shell.contains(event.target as Node) ||
        listbox?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };

    ownerDocument.addEventListener('pointerdown', handlePointerDown);
    return () => ownerDocument.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useLayoutEffect(() => {
    const ownerDocument = shellRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!open || !shellRef.current || !ownerWindow) {
      return;
    }

    const updateMenuStyle = () => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }
      const rect = shell.getBoundingClientRect();
      setMenuStyle({
        ...PANEL_SELECT_STYLES.menu,
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`
      });
    };

    updateMenuStyle();
    ownerWindow.addEventListener('resize', updateMenuStyle);
    ownerWindow.addEventListener('scroll', updateMenuStyle, true);
    return () => {
      ownerWindow.removeEventListener('resize', updateMenuStyle);
      ownerWindow.removeEventListener('scroll', updateMenuStyle, true);
    };
  }, [open]);

  const toggleOption = (option: PanelMultiSelectOption) => {
    const nextValues = selectedValueSet.has(option.value)
      ? selectedValues.filter(entry => entry !== option.value)
      : [...selectedValues, option.value];
    onChange(nextValues);
  };

  return (
    <div
      ref={shellRef}
      style={{...PANEL_SELECT_STYLES.shell, ...style}}
      onPointerDown={event => stopEventPropagation(event as unknown as Event)}
      onMouseDown={event => stopEventPropagation(event as unknown as Event)}
      onWheel={event => stopEventPropagation(event as unknown as Event)}
      onClick={event => stopEventPropagation(event as unknown as Event)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        style={{
          ...PANEL_SELECT_STYLES.button,
          ...(open ? PANEL_SELECT_STYLES.buttonOpen : {}),
          opacity: mergedOptions.length ? 1 : 0.58,
          cursor: mergedOptions.length ? 'pointer' : 'default'
        }}
        disabled={!mergedOptions.length}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          stopEventPropagation(event as unknown as Event);
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(current => !current);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onKeyUp={event => stopEventPropagation(event as unknown as Event)}
      >
        <span style={PANEL_SELECT_STYLES.summaryText}>{summaryLabel}</span>
        {trailingIcon ?? <PanelSelectChevron />}
      </button>
      {open && shellRef.current?.ownerDocument.body
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label={`${ariaLabel} options`}
              aria-multiselectable="true"
              style={menuStyle}
              onPointerDown={event => stopEventPropagation(event as unknown as Event)}
              onMouseDown={event => stopEventPropagation(event as unknown as Event)}
              onWheel={event => stopEventPropagation(event as unknown as Event)}
              onClick={event => stopEventPropagation(event as unknown as Event)}
            >
              <input
                aria-label={`${ariaLabel} search`}
                type="search"
                value={query}
                placeholder="Search..."
                style={PANEL_SELECT_STYLES.searchInput}
                onInput={event => setQuery(event.currentTarget.value)}
                onKeyDown={event => stopEventPropagation(event as unknown as Event)}
                onKeyUp={event => stopEventPropagation(event as unknown as Event)}
              />
              {filteredOptions.map(option => {
                const selected = selectedValueSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    style={{
                      ...PANEL_SELECT_STYLES.option,
                      ...(selected ? PANEL_SELECT_STYLES.optionSelected : {})
                    }}
                    onMouseDown={event => {
                      event.preventDefault();
                      stopEventPropagation(event as unknown as Event);
                    }}
                    onClick={() => toggleOption(option)}
                  >
                    <span>{option.label}</span>
                    {selected ? <span aria-hidden>✓</span> : null}
                  </button>
                );
              })}
              {filteredOptions.length === 0 ? (
                <div style={PANEL_SELECT_STYLES.emptyState}>No matching options</div>
              ) : null}
              {selectedValues.length > 0 ? (
                <button
                  type="button"
                  style={PANEL_SELECT_STYLES.clearButton}
                  onMouseDown={event => {
                    event.preventDefault();
                    stopEventPropagation(event as unknown as Event);
                  }}
                  onClick={() => onChange([])}
                >
                  Clear selection
                </button>
              ) : null}
            </div>,
            shellRef.current.ownerDocument.body
          )
        : null}
    </div>
  );
}

/**
 * Renders the default chevron glyph for the panel select trigger.
 */
function PanelSelectChevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={PANEL_SELECT_STYLES.chevron}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Preserves selected values that are not in the current option list so they can be cleared. */
function mergeSelectedMultiSelectOptions(
  options: ReadonlyArray<PanelMultiSelectOption>,
  selectedValues: readonly string[]
): PanelMultiSelectOption[] {
  const values = new Set(options.map(option => option.value));
  return [
    ...options,
    ...selectedValues
      .filter(value => !values.has(value))
      .map(value => ({
        label: value,
        value
      }))
  ];
}

/** Returns the compact button text for a multi-select value. */
function getMultiSelectSummaryLabel(
  selectedValues: readonly string[],
  options: ReadonlyArray<PanelMultiSelectOption>,
  placeholder: string
): string {
  if (selectedValues.length === 0) {
    return placeholder;
  }
  const labelsByValue = new Map(options.map(option => [option.value, option.label] as const));
  const labels = selectedValues.map(value => labelsByValue.get(value) ?? value);
  if (labels.length <= 2) {
    return labels.join(', ');
  }
  return `${labels.length} selected`;
}

/**
 * Stops panel select interactions from reaching deck gestures underneath the overlay.
 */
function stopEventPropagation(event: Event): void {
  event.stopPropagation();
  if (
    typeof (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation ===
    'function'
  ) {
    (event as {stopImmediatePropagation: () => void}).stopImmediatePropagation();
  }
}

/**
 * Returns the selected option index for the current serialized scalar value.
 */
function findSelectedOptionIndex(
  options: ReadonlyArray<PanelSelectOption>,
  value: PanelSelectValue
): number {
  return options.findIndex(option => String(option.value) === String(value));
}

/**
 * Advances an active option index cyclically for arrow-key navigation.
 */
function getNextOptionIndex(currentIndex: number, delta: -1 | 1, optionCount: number): number {
  if (optionCount === 0) {
    return -1;
  }
  const resolvedIndex = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
  return (resolvedIndex + delta + optionCount) % optionCount;
}

const PANEL_SELECT_STYLES = {
  shell: {
    position: 'relative',
    width: '100%',
    minWidth: 0
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    minHeight: 36,
    borderRadius: 13,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.24))',
    background: 'var(--menu-background, rgba(51, 65, 85, 0.78))',
    color: 'var(--menu-text, #f8fafc)',
    padding: '0 14px',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 650,
    textAlign: 'left',
    cursor: 'pointer'
  },
  buttonOpen: {
    borderColor: 'var(--button-icon-hover, rgba(96, 165, 250, 0.78))',
    boxShadow: '0 0 0 2px rgba(96, 165, 250, 0.16)'
  },
  menu: {
    position: 'fixed',
    zIndex: 10000,
    display: 'grid',
    gap: 2,
    maxHeight: 260,
    overflow: 'auto',
    borderRadius: 13,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.28))',
    background: 'var(--menu-background, #334155)',
    boxShadow: 'var(--menu-shadow, 0 16px 34px rgba(0, 0, 0, 0.32))',
    padding: 4
  },
  option: {
    minHeight: 30,
    border: 'none',
    borderRadius: 9,
    background: 'transparent',
    color: 'var(--menu-text, #f8fafc)',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 430,
    textAlign: 'left',
    cursor: 'pointer',
    padding: '0 10px',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 8
  },
  optionActive: {
    background: 'var(--menu-item-hover, rgba(148, 163, 184, 0.16))'
  },
  optionSelected: {
    background: 'var(--button-background, rgba(96, 165, 250, 0.36))',
    color: 'var(--menu-text, #f8fafc)',
    fontWeight: 520
  },
  summaryText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  searchInput: {
    minHeight: 30,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.28))',
    borderRadius: 9,
    background: 'var(--button-background, rgba(15, 23, 42, 0.22))',
    color: 'var(--menu-text, #f8fafc)',
    font: 'inherit',
    fontSize: 12,
    padding: '0 10px',
    outline: 'none'
  },
  emptyState: {
    color: 'var(--button-text, #94a3b8)',
    fontSize: 12,
    padding: '8px 10px'
  },
  clearButton: {
    minHeight: 30,
    border: 'none',
    borderRadius: 9,
    background: 'transparent',
    color: 'var(--button-text, #94a3b8)',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 520,
    textAlign: 'left',
    cursor: 'pointer',
    padding: '0 10px'
  },
  chevron: {
    width: 18,
    height: 18,
    flex: '0 0 auto',
    color: 'var(--button-text, #94a3b8)',
    pointerEvents: 'none'
  }
} satisfies Record<string, JSX.CSSProperties>;
