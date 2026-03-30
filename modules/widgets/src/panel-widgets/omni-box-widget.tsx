/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';
import {useCallback, useEffect, useRef, useState} from 'preact/hooks';

import type {Deck, Viewport, WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {ComponentChildren, JSX} from 'preact';

const OPTION_ROW_HEIGHT_PX = 32;
const MAX_VISIBLE_OPTION_COUNT = 4;
const BLUR_CLOSE_DELAY_MS = 100;
const OMNIBOX_MAX_WIDTH_PX = 520;
const OMNIBOX_HORIZONTAL_MARGIN_PX = 12;
const FALLBACK_WIDGET_MARGIN_PX = 8;
const WIDGET_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const OMNIBOX_CONTROL_HEIGHT = 'max(32px, calc(var(--button-size, 28px) - 2px))';
const OMNIBOX_INPUT_CLASS = 'deck-widget-omni-box-input';
const OMNIBOX_BUTTON_CLASS = 'deck-widget-omni-box-button';
const OMNIBOX_OPTION_CLASS = 'deck-widget-omni-box-option';
const OMNIBOX_OPTION_ACTIVE_CLASS = 'deck-widget-omni-box-option-active';

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  transform: 'translateX(-50%)',
  margin: '0',
  zIndex: '2',
  pointerEvents: 'auto'
};

const WRAPPER_STYLE: JSX.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--menu-gap, 4px)'
};

const INPUT_ROW_STYLE: JSX.CSSProperties = {
  width: '100%',
  display: 'grid',
  gridTemplateColumns: '1fr auto auto auto',
  gap: '1px',
  padding: '1px',
  overflow: 'hidden',
  backgroundColor: 'var(--button-stroke, rgba(255, 255, 255, 0.3))',
  borderRadius: 'var(--button-corner-radius, 8px)',
  boxShadow: 'var(--button-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25))'
};

const CONTROL_SURFACE_STYLE: JSX.CSSProperties = {
  height: OMNIBOX_CONTROL_HEIGHT,
  backgroundColor: 'var(--button-background, #fff)',
  backdropFilter: 'var(--button-backdrop-filter, unset)',
  WebkitBackdropFilter: 'var(--button-backdrop-filter, unset)',
  border: 'var(--button-inner-stroke, unset)'
};

const INPUT_STYLE: JSX.CSSProperties = {
  ...CONTROL_SURFACE_STYLE,
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '0 12px',
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 1px)',
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,
  color: 'var(--button-text, rgb(24, 24, 26))',
  fontSize: '13px',
  lineHeight: 1.2,
  fontFamily: WIDGET_FONT_FAMILY
};

const NAV_BUTTON_STYLE: JSX.CSSProperties = {
  ...CONTROL_SURFACE_STYLE,
  minWidth: 'calc(var(--button-size, 28px) - 2px)',
  padding: '0 10px',
  borderRadius: 0,
  color: 'var(--button-icon-idle, rgba(97, 97, 102, 1))',
  fontSize: '13px',
  fontWeight: 600,
  fontFamily: WIDGET_FONT_FAMILY,
  cursor: 'pointer',
  userSelect: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const NAV_BUTTON_DISABLED_STYLE: JSX.CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed'
};

const LAST_NAV_BUTTON_STYLE: JSX.CSSProperties = {
  borderTopRightRadius: 'calc(var(--button-corner-radius, 8px) - 1px)',
  borderBottomRightRadius: 'calc(var(--button-corner-radius, 8px) - 1px)'
};

const DROPDOWN_STYLE: JSX.CSSProperties = {
  borderRadius: 'var(--button-corner-radius, 8px)',
  border: 'var(--menu-border, unset)',
  backgroundColor: 'var(--menu-background, #fff)',
  backdropFilter: 'var(--menu-backdrop-filter, unset)',
  WebkitBackdropFilter: 'var(--menu-backdrop-filter, unset)',
  boxShadow: 'var(--menu-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  overflowY: 'auto',
  maxHeight: `${OPTION_ROW_HEIGHT_PX * MAX_VISIBLE_OPTION_COUNT}px`,
  padding: '4px 0'
};

const DEFAULT_OPTION_CONTENT_STYLE: JSX.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px'
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target instanceof HTMLInputElement) {
    return target.type !== 'button' && target.type !== 'checkbox' && target.type !== 'radio';
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  return target instanceof HTMLElement ? target.isContentEditable : false;
}

function getWidgetMarginPx(element: HTMLElement): number {
  const value = window.getComputedStyle(element).getPropertyValue('--widget-margin').trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : FALLBACK_WIDGET_MARGIN_PX;
}

function getDeckCanvasRect(deck: Deck | undefined): DOMRect | null {
  const canvas = (deck as (Deck & {canvas?: HTMLCanvasElement | null}) | undefined)?.canvas;
  if (!canvas) {
    return null;
  }
  return canvas.getBoundingClientRect();
}

export type OmniBoxOption = {
  id: string;
  label: string;
  value?: string;
  description?: string;
  data?: unknown;
};

export type OmniBoxOptionProvider =
  | ((query: string) => Promise<ReadonlyArray<OmniBoxOption>>)
  | ((query: string) => ReadonlyArray<OmniBoxOption>);

export type OmniBoxRenderOptionArgs = {
  option: OmniBoxOption;
  index: number;
  isActive: boolean;
  query: string;
};

export type OmniBoxWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  placeholder?: string;
  minQueryLength?: number;
  defaultOpen?: boolean;
  topOffsetPx?: number;
  getOptions?: OmniBoxOptionProvider;
  renderOption?: (args: OmniBoxRenderOptionArgs) => ComponentChildren;
  onSelectOption?: (option: OmniBoxOption) => void;
  onActiveOptionChange?: (option: OmniBoxOption | null) => void;
  onNavigateOption?: (option: OmniBoxOption) => void;
  onQueryChange?: (query: string) => void;
};

type OmniBoxWidgetViewProps = {
  placeholder: string;
  minQueryLength: number;
  defaultOpen: boolean;
  getOptions: OmniBoxOptionProvider;
  renderOption?: (args: OmniBoxRenderOptionArgs) => ComponentChildren;
  onSelectOption?: (option: OmniBoxOption) => void;
  onActiveOptionChange?: (option: OmniBoxOption | null) => void;
  onNavigateOption?: (option: OmniBoxOption) => void;
  onQueryChange?: (query: string) => void;
};

function DefaultOptionContent({option}: {option: OmniBoxOption}) {
  return (
    <div style={DEFAULT_OPTION_CONTENT_STYLE}>
      <span
        style={{
          fontSize: '12px',
          color: 'var(--menu-text, rgb(24, 24, 26))',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {option.label}
      </span>
      {option.description && (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--menu-text, rgb(24, 24, 26))',
            opacity: 0.7,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {option.description}
        </span>
      )}
    </div>
  );
}

function OmniBoxWidgetStyles() {
  return (
    <style>{`
      .deck-widget-omni-box .${OMNIBOX_INPUT_CLASS}:focus,
      .deck-widget-omni-box .${OMNIBOX_BUTTON_CLASS}:focus,
      .deck-widget-omni-box .${OMNIBOX_OPTION_CLASS}:focus {
        outline: none;
      }

      .deck-widget-omni-box [data-omni-box-controls='true'] {
        background-color: var(--button-stroke, rgba(255, 255, 255, 0.3));
      }

      .deck-widget-omni-box [data-omni-box-dropdown='true'] {
        background-color: var(--menu-background, #fff);
        backdrop-filter: var(--menu-backdrop-filter, unset);
        -webkit-backdrop-filter: var(--menu-backdrop-filter, unset);
        box-shadow: var(--menu-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25));
      }

      .deck-widget-omni-box .${OMNIBOX_INPUT_CLASS}::placeholder {
        color: var(--button-icon-idle, rgba(97, 97, 102, 1));
        opacity: 1;
      }

      .deck-widget-omni-box .${OMNIBOX_BUTTON_CLASS}:not(:disabled):hover {
        color: var(--button-icon-hover, rgba(24, 24, 26, 1));
      }

      .deck-widget-omni-box .${OMNIBOX_OPTION_CLASS}:not(.${OMNIBOX_OPTION_ACTIVE_CLASS}):hover {
        background: var(--menu-item-hover, rgba(0, 0, 0, 0.08));
      }
    `}</style>
  );
}

// eslint-disable-next-line max-statements
function OmniBoxWidgetView({
  placeholder,
  minQueryLength,
  defaultOpen,
  getOptions,
  renderOption,
  onSelectOption,
  onActiveOptionChange,
  onNavigateOption,
  onQueryChange
}: OmniBoxWidgetViewProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ReadonlyArray<OmniBoxOption>>([]);
  const [activeOptionIndex, setActiveOptionIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isHidden, setIsHidden] = useState(() => !defaultOpen);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const optionElementRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestVersionRef = useRef(0);
  const blurTimeoutRef = useRef<number | null>(null);

  const clearBlurTimeout = useCallback(() => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearBlurTimeout();
    };
  }, [clearBlurTimeout]);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      stopEventPropagation(event);
      clearBlurTimeout();
      setIsHidden(false);
      setIsFocused(true);

      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, true);
    };
  }, [clearBlurTimeout]);

  useEffect(() => {
    setIsHidden(!defaultOpen);
  }, [defaultOpen]);

  useEffect(() => {
    onQueryChange?.(query);

    const normalizedQuery = query.trim();
    if (normalizedQuery.length < minQueryLength) {
      setOptions([]);
      setActiveOptionIndex(-1);
      setIsLoading(false);
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setIsLoading(true);

    Promise.resolve(getOptions(normalizedQuery))
      .then((nextOptions) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setOptions(nextOptions);
        setActiveOptionIndex(nextOptions.length > 0 ? 0 : -1);
      })
      .catch(() => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setOptions([]);
        setActiveOptionIndex(-1);
      })
      .finally(() => {
        if (requestVersionRef.current === requestVersion) {
          setIsLoading(false);
        }
      });
  }, [getOptions, minQueryLength, onQueryChange, query]);

  useEffect(() => {
    if (activeOptionIndex < 0 || activeOptionIndex >= options.length) {
      onActiveOptionChange?.(null);
      return;
    }
    onActiveOptionChange?.(options[activeOptionIndex] ?? null);
  }, [activeOptionIndex, onActiveOptionChange, options]);

  useEffect(() => {
    optionElementRefs.current = optionElementRefs.current.slice(0, options.length);
  }, [options.length]);

  useEffect(() => {
    if (!isFocused || activeOptionIndex < 0 || activeOptionIndex >= options.length) {
      return;
    }

    const dropdownElement = dropdownRef.current;
    const optionElement = optionElementRefs.current[activeOptionIndex];
    if (!dropdownElement || !optionElement) {
      return;
    }

    const optionTop = optionElement.offsetTop;
    const optionBottom = optionTop + optionElement.offsetHeight;
    const viewportTop = dropdownElement.scrollTop;
    const viewportBottom = viewportTop + dropdownElement.clientHeight;

    if (optionTop < viewportTop) {
      dropdownElement.scrollTop = optionTop;
      return;
    }

    if (optionBottom > viewportBottom) {
      dropdownElement.scrollTop = optionBottom - dropdownElement.clientHeight;
    }
  }, [activeOptionIndex, isFocused, options.length]);

  const selectOption = useCallback(
    (option: OmniBoxOption) => {
      setQuery(option.value ?? option.label);
      setIsFocused(false);
      setOptions([]);
      setActiveOptionIndex(-1);
      onSelectOption?.(option);
    },
    [onSelectOption]
  );

  const moveActiveOptionBy = useCallback(
    (delta: -1 | 1, {navigate = false}: {navigate?: boolean} = {}) => {
      if (!options.length) {
        return;
      }
      const currentIndex = activeOptionIndex >= 0 ? activeOptionIndex : 0;
      const nextIndex = (currentIndex + delta + options.length) % options.length;
      const nextOption = options[nextIndex];
      if (!nextOption) {
        return;
      }
      setActiveOptionIndex(nextIndex);
      setIsFocused(true);
      if (navigate) {
        onNavigateOption?.(nextOption);
      }
    },
    [activeOptionIndex, onNavigateOption, options]
  );

  const handleHide = useCallback(
    (event?: Event) => {
      if (event) {
        stopEventPropagation(event);
      }

      clearBlurTimeout();
      requestVersionRef.current += 1;
      setQuery('');
      setOptions([]);
      setActiveOptionIndex(-1);
      setIsLoading(false);
      setIsFocused(false);
      setIsHidden(true);
    },
    [clearBlurTimeout]
  );

  const handleInput: JSX.GenericEventHandler<HTMLInputElement> = useCallback((event) => {
    stopEventPropagation(event as unknown as Event);
    setQuery(event.currentTarget.value);
    setIsFocused(true);
  }, []);

  const handleFocus: JSX.FocusEventHandler<HTMLInputElement> = useCallback(() => {
    clearBlurTimeout();
    setIsFocused(true);
  }, [clearBlurTimeout]);

  const handleBlur: JSX.FocusEventHandler<HTMLInputElement> = useCallback(() => {
    clearBlurTimeout();
    blurTimeoutRef.current = window.setTimeout(() => {
      setIsFocused(false);
      setActiveOptionIndex(-1);
    }, BLUR_CLOSE_DELAY_MS);
  }, [clearBlurTimeout]);

  const handleKeyDown: JSX.KeyboardEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      stopEventPropagation(event as unknown as Event);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActiveOptionBy(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActiveOptionBy(-1);
        return;
      }

      if (event.key === 'Enter') {
        if (activeOptionIndex >= 0 && activeOptionIndex < options.length) {
          event.preventDefault();
          const option = options[activeOptionIndex];
          if (option) {
            selectOption(option);
          }
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        handleHide(event as unknown as Event);
      }
    },
    [activeOptionIndex, handleHide, moveActiveOptionBy, options, selectOption]
  );

  const handlePointerEvent: JSX.PointerEventHandler<HTMLElement> = useCallback((event) => {
    stopEventPropagation(event as unknown as Event);
  }, []);

  const handleMouseEvent: JSX.MouseEventHandler<HTMLElement> = useCallback((event) => {
    stopEventPropagation(event as unknown as Event);
  }, []);

  const handleWheelEvent: JSX.WheelEventHandler<HTMLElement> = useCallback((event) => {
    stopEventPropagation(event as unknown as Event);
  }, []);

  const hasMatches = options.length > 0;
  const normalizedQuery = query.trim();
  const shouldShowDropdown =
    !isHidden &&
    isFocused &&
    normalizedQuery.length >= minQueryLength &&
    (isLoading || options.length > 0);

  if (isHidden) {
    return null;
  }

  return (
    <div
      style={WRAPPER_STYLE}
      onPointerDown={handlePointerEvent}
      onPointerMove={handlePointerEvent}
      onPointerUp={handlePointerEvent}
      onMouseDown={handleMouseEvent}
      onMouseMove={handleMouseEvent}
      onMouseUp={handleMouseEvent}
      onWheel={handleWheelEvent}
    >
      <OmniBoxWidgetStyles />
      <div data-omni-box-controls="true" style={INPUT_ROW_STYLE}>
        <input
          className={OMNIBOX_INPUT_CLASS}
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          style={INPUT_STYLE}
          onInput={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          aria-label="OmniBox"
        />

        <button
          className={OMNIBOX_BUTTON_CLASS}
          type="button"
          title="Previous match"
          aria-label="Previous match"
          disabled={!hasMatches}
          style={{
            ...NAV_BUTTON_STYLE,
            ...(hasMatches ? {} : NAV_BUTTON_DISABLED_STYLE)
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            stopEventPropagation(event as unknown as Event);
          }}
          onClick={(event) => {
            stopEventPropagation(event as unknown as Event);
            moveActiveOptionBy(-1, {navigate: true});
          }}
        >
          {'<'}
        </button>

        <button
          className={OMNIBOX_BUTTON_CLASS}
          type="button"
          title="Next match"
          aria-label="Next match"
          disabled={!hasMatches}
          style={{
            ...NAV_BUTTON_STYLE,
            ...(hasMatches ? {} : NAV_BUTTON_DISABLED_STYLE)
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            stopEventPropagation(event as unknown as Event);
          }}
          onClick={(event) => {
            stopEventPropagation(event as unknown as Event);
            moveActiveOptionBy(1, {navigate: true});
          }}
        >
          {'>'}
        </button>

        <button
          className={OMNIBOX_BUTTON_CLASS}
          type="button"
          title="Hide OmniBox"
          aria-label="Hide OmniBox"
          style={{
            ...NAV_BUTTON_STYLE,
            ...LAST_NAV_BUTTON_STYLE
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            stopEventPropagation(event as unknown as Event);
          }}
          onClick={(event) => {
            handleHide(event as unknown as Event);
          }}
        >
          ×
        </button>
      </div>

      {shouldShowDropdown && (
        <div
          ref={dropdownRef}
          role="listbox"
          data-omni-box-dropdown="true"
          style={DROPDOWN_STYLE}
          aria-label="OmniBox suggestions"
        >
          {isLoading && (
            <div
              style={{
                height: `${OPTION_ROW_HEIGHT_PX}px`,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                fontSize: '12px',
                color: 'var(--menu-text, rgb(24, 24, 26))',
                opacity: 0.7,
                fontFamily: WIDGET_FONT_FAMILY
              }}
            >
              Searching…
            </div>
          )}

          {!isLoading &&
            options.map((option, index) => {
              const isActive = index === activeOptionIndex;
              const content = renderOption?.({
                option,
                index,
                isActive,
                query
              }) ?? <DefaultOptionContent option={option} />;

              return (
                <button
                  key={option.id}
                  className={[OMNIBOX_OPTION_CLASS, isActive ? OMNIBOX_OPTION_ACTIVE_CLASS : '']
                    .filter(Boolean)
                    .join(' ')}
                  ref={(element) => {
                    optionElementRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    stopEventPropagation(event as unknown as Event);
                  }}
                  onClick={(event) => {
                    stopEventPropagation(event as unknown as Event);
                    selectOption(option);
                  }}
                  style={{
                    width: '100%',
                    border: 0,
                    height: `${OPTION_ROW_HEIGHT_PX}px`,
                    display: 'flex',
                    alignItems: 'stretch',
                    textAlign: 'left',
                    padding: '0 12px',
                    cursor: 'pointer',
                    backgroundColor: isActive
                      ? 'var(--menu-item-hover, rgba(0, 0, 0, 0.08))'
                      : 'transparent',
                    color: 'var(--menu-text, rgb(24, 24, 26))',
                    fontFamily: WIDGET_FONT_FAMILY
                  }}
                >
                  {content}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

export class OmniBoxWidget extends Widget<OmniBoxWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'omni-box',
    placement: 'top-left',
    placeholder: 'Search trace blocks…',
    minQueryLength: 1,
    defaultOpen: false,
    topOffsetPx: undefined,
    getOptions: (() => []) as OmniBoxOptionProvider,
    renderOption: undefined,
    onSelectOption: undefined,
    onActiveOptionChange: undefined,
    onNavigateOption: undefined,
    onQueryChange: undefined
  } satisfies Required<WidgetProps> &
    Required<Pick<OmniBoxWidgetProps, 'placeholder' | 'minQueryLength' | 'placement'>> &
    OmniBoxWidgetProps;

  placement: WidgetPlacement = OmniBoxWidget.defaultProps.placement;
  className = 'deck-widget-omni-box';

  #rootElement: HTMLElement | null = null;
  #hasLayoutListeners = false;

  #handleWindowLayoutChange = () => {
    this.#updateRootLayout();
  };

  constructor(props: OmniBoxWidgetProps = {}) {
    super({...OmniBoxWidget.defaultProps, ...props});
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
  }

  override setProps(props: Partial<OmniBoxWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;

    rootElement.className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');

    Object.assign(rootElement.style, ROOT_STYLE);
    this.#attachLayoutListeners();
    this.#updateRootLayout();

    render(
      <OmniBoxWidgetView
        placeholder={this.props.placeholder ?? OmniBoxWidget.defaultProps.placeholder}
        minQueryLength={this.props.minQueryLength ?? OmniBoxWidget.defaultProps.minQueryLength}
        defaultOpen={this.props.defaultOpen ?? OmniBoxWidget.defaultProps.defaultOpen}
        getOptions={this.props.getOptions ?? OmniBoxWidget.defaultProps.getOptions}
        renderOption={this.props.renderOption}
        onSelectOption={this.props.onSelectOption}
        onActiveOptionChange={this.props.onActiveOptionChange}
        onNavigateOption={this.props.onNavigateOption}
        onQueryChange={this.props.onQueryChange}
      />,
      rootElement
    );
  }

  override onViewportChange(_viewport: Viewport): void {
    this.#updateRootLayout();
  }

  override onRemove(): void {
    this.#detachLayoutListeners();
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  #attachLayoutListeners(): void {
    if (this.#hasLayoutListeners || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('resize', this.#handleWindowLayoutChange);
    window.addEventListener('scroll', this.#handleWindowLayoutChange, true);
    this.#hasLayoutListeners = true;
  }

  #detachLayoutListeners(): void {
    if (!this.#hasLayoutListeners || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('resize', this.#handleWindowLayoutChange);
    window.removeEventListener('scroll', this.#handleWindowLayoutChange, true);
    this.#hasLayoutListeners = false;
  }

  #updateRootLayout(): void {
    if (!this.#rootElement || typeof window === 'undefined') {
      return;
    }

    const fallbackTopOffsetPx = getWidgetMarginPx(this.#rootElement);
    const configuredTopOffsetPx = this.props.topOffsetPx;
    const topOffsetPx =
      configuredTopOffsetPx !== undefined && Number.isFinite(configuredTopOffsetPx)
        ? configuredTopOffsetPx
        : fallbackTopOffsetPx;
    const canvasRect = getDeckCanvasRect(this.deck);

    if (canvasRect) {
      const availableWidthPx = Math.max(0, canvasRect.width - OMNIBOX_HORIZONTAL_MARGIN_PX * 2);
      const resolvedWidthPx =
        availableWidthPx > 0
          ? Math.min(OMNIBOX_MAX_WIDTH_PX, availableWidthPx)
          : OMNIBOX_MAX_WIDTH_PX;

      this.#rootElement.style.left = `${canvasRect.left + canvasRect.width / 2}px`;
      this.#rootElement.style.top = `${canvasRect.top + topOffsetPx}px`;
      this.#rootElement.style.width = `${resolvedWidthPx}px`;
      return;
    }

    this.#rootElement.style.left = '50%';
    this.#rootElement.style.top = `${topOffsetPx}px`;
    this.#rootElement.style.width = `min(${OMNIBOX_MAX_WIDTH_PX}px, calc(100vw - ${OMNIBOX_HORIZONTAL_MARGIN_PX * 2}px))`;
  }
}
