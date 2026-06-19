/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {createPortal} from 'preact/compat';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'preact/hooks';

import type {SettingValue} from '../lib/settings/settings';
import type {JSX} from 'preact';

export type SelectComponentOption = {
  /** Human-friendly label shown in the select control. */
  label: string;
  /** Primitive setting value written when the option is selected. */
  value: SettingValue;
  /** Optional supporting copy shown below the option label in an open select menu. */
  description?: string;
};

export type SelectComponentProps = {
  id: string;
  label: string;
  value: SettingValue;
  options: SelectComponentOption[];
  onValueChange: (nextValue: SettingValue) => void;
  /** Optional text size used by the closed control and open menu options. */
  fontSize?: number | string;
};

type OpenSelectRegistration = {
  close: () => void;
  root: HTMLDivElement;
};

const OPEN_SELECTS_BY_DOCUMENT = new WeakMap<Document, OpenSelectRegistration>();

const SELECT_ROOT_STYLE: JSX.CSSProperties = {
  position: 'relative',
  width: '100%',
  minWidth: 0
};

const SELECT_BUTTON_STYLE: JSX.CSSProperties = {
  width: '100%',
  minHeight: '32px',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '8px',
  border: 'var(--button-inner-stroke, 1px solid rgba(148, 163, 184, 0.48))',
  borderRadius: 'var(--button-corner-radius, 8px)',
  background: 'var(--button-background, rgba(255, 255, 255, 0.94))',
  color: 'var(--button-text, currentColor)',
  boxSizing: 'border-box',
  padding: '6px 8px 6px 10px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: 'none',
  outline: 'none'
};

const SELECT_BUTTON_OPEN_STYLE: JSX.CSSProperties = {
  borderColor: 'var(--button-icon-hover, rgba(59, 130, 246, 0.82))',
  boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.16)'
};

const SELECT_VALUE_STYLE: JSX.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left'
};

const SELECT_CARET_STYLE: JSX.CSSProperties = {
  width: '16px',
  height: '16px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--button-icon-idle, currentColor)',
  fontSize: '10px',
  lineHeight: 1,
  transition: 'transform 120ms ease'
};

const SELECT_LIST_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  zIndex: 10000,
  width: 'max-content',
  maxWidth: 'calc(100vw - 16px)',
  maxHeight: '192px',
  overflowX: 'hidden',
  overflowY: 'auto',
  padding: '4px',
  border: 'var(--button-inner-stroke, 1px solid rgba(148, 163, 184, 0.48))',
  borderRadius: 'var(--button-corner-radius, 8px)',
  background: 'var(--container-background, var(--button-background, rgba(255, 255, 255, 0.98)))',
  color: 'var(--button-text, currentColor)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.18)',
  boxSizing: 'border-box'
};

const SELECT_OPTION_STYLE: JSX.CSSProperties = {
  width: '100%',
  minHeight: '28px',
  border: 0,
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 1px)',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '8px',
  margin: 0,
  padding: '5px 8px',
  background: 'transparent',
  color: 'var(--button-text, currentColor)',
  cursor: 'pointer',
  fontSize: '12px',
  textAlign: 'left'
};

const SELECT_OPTION_CONTENT_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: '1px'
};

const SELECT_OPTION_LABEL_STYLE: JSX.CSSProperties = {
  whiteSpace: 'nowrap',
  textAlign: 'left'
};

const SELECT_OPTION_DESCRIPTION_STYLE: JSX.CSSProperties = {
  color: 'var(--button-icon-idle, currentColor)',
  fontSize: '11px',
  fontWeight: 400,
  lineHeight: 1.25,
  opacity: 0.78,
  textAlign: 'left',
  whiteSpace: 'normal'
};

const SELECT_OPTION_ACTIVE_STYLE: JSX.CSSProperties = {
  background: 'var(--menu-item-hover, rgba(148, 163, 184, 0.16))'
};

const SELECT_OPTION_SELECTED_STYLE: JSX.CSSProperties = {
  color: 'var(--button-icon-hover, currentColor)',
  fontWeight: 700
};

function stopEventPropagation(event: Event): void {
  event.stopPropagation();
  if (
    typeof (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation ===
    'function'
  ) {
    (event as {stopImmediatePropagation: () => void}).stopImmediatePropagation();
  }
}

function findSelectedOptionIndex(options: SelectComponentOption[], value: SettingValue): number {
  return options.findIndex(option => option.value === value);
}

function getNextOptionIndex(currentIndex: number, delta: -1 | 1, optionCount: number): number {
  if (optionCount === 0) {
    return -1;
  }
  const resolvedIndex = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
  return (resolvedIndex + delta + optionCount) % optionCount;
}

function registerOpenSelect(root: HTMLDivElement, close: () => void): void {
  const ownerDocument = root.ownerDocument;
  const openSelect = OPEN_SELECTS_BY_DOCUMENT.get(ownerDocument);
  if (openSelect && openSelect.root !== root) {
    openSelect.close();
  }
  OPEN_SELECTS_BY_DOCUMENT.set(ownerDocument, {close, root});
}

function unregisterOpenSelect(root: HTMLDivElement): void {
  const ownerDocument = root.ownerDocument;
  if (OPEN_SELECTS_BY_DOCUMENT.get(ownerDocument)?.root === root) {
    OPEN_SELECTS_BY_DOCUMENT.delete(ownerDocument);
  }
}

export function SelectComponent({
  id,
  label,
  value,
  options,
  onValueChange,
  fontSize
}: SelectComponentProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(() =>
    findSelectedOptionIndex(options, value)
  );
  const [listStyle, setListStyle] = useState<JSX.CSSProperties>(SELECT_LIST_STYLE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `${id}-listbox`;

  const selectedOptionIndex = useMemo(
    () => findSelectedOptionIndex(options, value),
    [options, value]
  );
  const selectedOption = selectedOptionIndex >= 0 ? options[selectedOptionIndex] : undefined;
  const selectedLabel = selectedOption?.label ?? String(value);

  const closeSelect = () => {
    const root = rootRef.current;
    if (root) {
      unregisterOpenSelect(root);
    }
    setIsOpen(false);
  };

  const openSelect = () => {
    const root = rootRef.current;
    if (root) {
      registerOpenSelect(root, closeSelect);
    }
    setIsOpen(true);
  };

  const selectOption = (option: SelectComponentOption) => {
    onValueChange(option.value);
    closeSelect();
  };

  useEffect(() => {
    optionRefs.current = optionRefs.current.slice(0, options.length);
  }, [options.length]);

  useEffect(() => {
    if (!isOpen) {
      setActiveOptionIndex(selectedOptionIndex);
    }
  }, [isOpen, selectedOptionIndex]);

  useEffect(() => {
    const ownerDocument = rootRef.current?.ownerDocument;
    if (!isOpen || !ownerDocument) {
      return undefined;
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!rootRef.current || !event.target) {
        return;
      }
      const target = event.target as Node;
      if (!rootRef.current.contains(target) && !listboxRef.current?.contains(target)) {
        closeSelect();
      }
    };

    ownerDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    };
  }, [isOpen]);

  useEffect(() => {
    const root = rootRef.current;
    if (!isOpen || !root) {
      return undefined;
    }

    registerOpenSelect(root, closeSelect);
    return () => {
      unregisterOpenSelect(root);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    const ownerDocument = rootRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!isOpen || !rootRef.current || !ownerWindow) {
      return undefined;
    }

    const updateListStyle = () => {
      if (!rootRef.current) {
        return;
      }
      const rect = rootRef.current.getBoundingClientRect();
      const viewportWidth =
        ownerDocument.documentElement.clientWidth || ownerWindow.innerWidth || rect.right;
      const viewportPadding = 8;
      const alignRight = viewportWidth - rect.right < rect.left;
      const edgeOffset = alignRight
        ? Math.max(viewportWidth - rect.right, viewportPadding)
        : Math.max(rect.left, viewportPadding);
      const availableWidth = alignRight
        ? Math.max(rect.right - viewportPadding, 0)
        : Math.max(viewportWidth - edgeOffset - viewportPadding, 0);
      setListStyle({
        ...SELECT_LIST_STYLE,
        top: `${rect.bottom + 4}px`,
        left: alignRight ? undefined : `${edgeOffset}px`,
        right: alignRight ? `${edgeOffset}px` : undefined,
        minWidth: `${Math.min(rect.width, availableWidth)}px`,
        maxWidth: `${availableWidth}px`
      });
    };

    updateListStyle();
    ownerWindow.addEventListener('resize', updateListStyle);
    ownerWindow.addEventListener('scroll', updateListStyle, true);
    return () => {
      ownerWindow.removeEventListener('resize', updateListStyle);
      ownerWindow.removeEventListener('scroll', updateListStyle, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeOptionIndex < 0) {
      return;
    }
    optionRefs.current[activeOptionIndex]?.scrollIntoView?.({block: 'nearest'});
  }, [activeOptionIndex, isOpen]);

  const handleButtonClick = () => {
    if (isOpen) {
      closeSelect();
      return;
    }
    openSelect();
  };

  const handleButtonKeyDown: JSX.KeyboardEventHandler<HTMLButtonElement> = event => {
    stopEventPropagation(event as unknown as Event);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openSelect();
      setActiveOptionIndex(previous =>
        getNextOptionIndex(previous, event.key === 'ArrowDown' ? 1 : -1, options.length)
      );
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen && activeOptionIndex >= 0) {
        const activeOption = options[activeOptionIndex];
        if (activeOption) {
          selectOption(activeOption);
        }
        return;
      }
      openSelect();
      setActiveOptionIndex(selectedOptionIndex);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelect();
    }
  };

  return (
    <div
      ref={rootRef}
      style={SELECT_ROOT_STYLE}
      onPointerDown={event => stopEventPropagation(event as unknown as Event)}
      onMouseDown={event => stopEventPropagation(event as unknown as Event)}
      onWheel={event => stopEventPropagation(event as unknown as Event)}
      onClick={event => stopEventPropagation(event as unknown as Event)}
    >
      <button
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        style={{
          ...SELECT_BUTTON_STYLE,
          ...(fontSize === undefined ? {} : {fontSize}),
          ...(isOpen ? SELECT_BUTTON_OPEN_STYLE : {}),
          opacity: options.length ? 1 : 0.58,
          cursor: options.length ? 'pointer' : 'default'
        }}
        disabled={!options.length}
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
        onKeyUp={event => stopEventPropagation(event as unknown as Event)}
      >
        <span style={SELECT_VALUE_STYLE}>{selectedLabel}</span>
        <span
          aria-hidden
          style={{
            ...SELECT_CARET_STYLE,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
          }}
        >
          ▾
        </span>
      </button>

      {isOpen &&
        rootRef.current?.ownerDocument.body &&
        createPortal(
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            style={listStyle}
            onPointerDown={event => stopEventPropagation(event as unknown as Event)}
            onMouseDown={event => stopEventPropagation(event as unknown as Event)}
            onWheel={event => stopEventPropagation(event as unknown as Event)}
            onClick={event => stopEventPropagation(event as unknown as Event)}
          >
            {options.map((option, index) => {
              const isSelected = index === selectedOptionIndex;
              const isActive = index === activeOptionIndex;
              const description = option.description?.trim();

              return (
                <button
                  key={`${id}-${index}-${String(option.value)}`}
                  ref={element => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  style={{
                    ...SELECT_OPTION_STYLE,
                    ...(fontSize === undefined ? {} : {fontSize}),
                    ...(isActive ? SELECT_OPTION_ACTIVE_STYLE : {}),
                    ...(isSelected ? SELECT_OPTION_SELECTED_STYLE : {})
                  }}
                  onPointerEnter={() => setActiveOptionIndex(index)}
                  onMouseDown={event => {
                    event.preventDefault();
                    stopEventPropagation(event as unknown as Event);
                  }}
                  onClick={() => selectOption(option)}
                >
                  <span style={SELECT_OPTION_CONTENT_STYLE}>
                    <span data-select-option-label="true" style={SELECT_OPTION_LABEL_STYLE}>
                      {option.label}
                    </span>
                    {description && (
                      <span
                        data-select-option-description="true"
                        style={SELECT_OPTION_DESCRIPTION_STYLE}
                      >
                        {description}
                      </span>
                    )}
                  </span>
                  {isSelected && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>,
          rootRef.current.ownerDocument.body
        )}
    </div>
  );
}
