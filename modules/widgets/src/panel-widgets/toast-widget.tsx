/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';

import {toastManager} from './toast-manager';

import type {ToastEntry, ToastKind} from './toast-manager';
import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {JSX} from 'preact';

export type ToastWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  showBorder?: boolean;
};

type ToastWidgetViewProps = {
  toasts: ReadonlyArray<ToastEntry>;
  showBorder: boolean;
};

const TOAST_KIND_STYLES: Record<ToastKind, {accent: string; background: string; icon: string}> = {
  error: {
    accent: 'var(--deck-widget-error-color, var(--button-icon-idle, currentColor))',
    background: 'var(--button-background)',
    icon: '⚠'
  },
  info: {
    accent: 'var(--deck-widget-info-color, var(--button-icon-idle, currentColor))',
    background: 'var(--button-background)',
    icon: 'ⓘ'
  },
  warning: {
    accent: 'var(--deck-widget-warning-color, var(--button-icon-idle, currentColor))',
    background: 'var(--button-background)',
    icon: '⚠'
  }
};

const TOAST_KIND_ICON_COLOR: Record<ToastKind, string> = {
  error: 'var(--deck-widget-error-color, var(--button-icon-idle, currentColor))',
  info: 'var(--deck-widget-info-color, var(--button-icon-idle, currentColor))',
  warning: 'var(--deck-widget-warning-color, var(--button-icon-idle, currentColor))'
};

const TOAST_CONTAINER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--widget-margin, 8px)',
  alignItems: 'stretch',
  pointerEvents: 'auto',
  width: '100%',
  maxWidth: 'calc(100vw - 24px)',
  maxHeight: 'calc(100vh - 24px)',
  overflow: 'auto',
  boxSizing: 'border-box'
};

const TOAST_CARD_STYLE: JSX.CSSProperties = {
  position: 'relative',
  borderRadius: 'var(--button-corner-radius, 8px)',
  border: '1px solid transparent',
  borderLeft: '4px solid transparent',
  boxShadow: 'var(--button-shadow)',
  backgroundColor: 'var(--button-background)',
  color: 'var(--button-text)',
  padding: '10px 10px 10px 12px',
  width: '100%',
  minWidth: 0,
  animation: 'deck-toast-enter 160ms ease-out',
  transformOrigin: 'top right',
  backdropFilter: 'var(--button-backdrop-filter)',
  WebkitBackdropFilter: 'var(--button-backdrop-filter)'
};

const CLOSE_BUTTON_STYLE: JSX.CSSProperties = {
  border: 0,
  borderRadius: 'var(--button-corner-radius, 4px)',
  color: 'var(--button-text)',
  background: 'transparent',
  width: '22px',
  height: '22px',
  fontSize: '12px',
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0,
  minWidth: 'unset',
  minHeight: 'unset'
};

const TOAST_WIDGET_CLASS = 'deck-widget-toast';
const TOAST_WIDGET_STACK_CLASS = 'deck-widget-toast-stack';

function ToastWidgetStyles() {
  return (
    <style>{`
      @keyframes deck-toast-enter {
        from {
          opacity: 0;
          transform: translateY(4px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .${TOAST_WIDGET_CLASS} {
        color: var(--button-text);
        pointer-events: auto;
        position: relative;
        z-index: 3;
      }

      .${TOAST_WIDGET_STACK_CLASS} {
        margin: 0;
      }

      .${TOAST_WIDGET_CLASS} .deck-widget-icon-button {
        border: 0;
        box-shadow: none;
      }
    `}</style>
  );
}

function ToastWidgetView({toasts, showBorder}: ToastWidgetViewProps) {
  return (
    <div
      className={TOAST_WIDGET_STACK_CLASS}
      style={TOAST_CONTAINER_STYLE}
      role="status"
      aria-live="polite"
    >
      <ToastWidgetStyles />
      {toasts.map((toast) => {
        const palette = TOAST_KIND_STYLES[toast.type];
        const iconColor = TOAST_KIND_ICON_COLOR[toast.type];

        return (
          <div
            key={toast.id}
            style={{
              ...TOAST_CARD_STYLE,
              backgroundColor: palette.background,
              borderLeftColor: palette.accent,
              boxShadow: showBorder
                ? 'inset 0 0 0 0.5px var(--deck-widget-toast-border, rgba(148, 163, 184, 0.35)), var(--button-shadow)'
                : 'var(--button-shadow)'
            }}
            data-toast-id={toast.id}
          >
            <div
              style={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'start',
                gap: '8px'
              }}
            >
              <div style={{fontSize: '16px', lineHeight: 1, color: iconColor}} aria-hidden="true">
                {palette.icon}
              </div>
              <div style={{minWidth: 0}}>
                {toast.title && (
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: 'var(--button-text)',
                      marginBottom: '2px'
                    }}
                  >
                    {toast.title}
                  </div>
                )}
                <div
                  style={{
                    fontSize: '12px',
                    lineHeight: 1.35,
                    color: 'var(--button-text)',
                    opacity: '0.8'
                  }}
                >
                  {toast.message}
                </div>
              </div>
              <button
                className="deck-widget-icon-button"
                type="button"
                title="Dismiss"
                aria-label="Dismiss toast"
                style={CLOSE_BUTTON_STYLE}
                onClick={() => toastManager.dismiss(toast.id)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                data-toast-close={toast.id}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export class ToastWidget extends Widget<ToastWidgetProps> {
  static defaultProps: Required<ToastWidgetProps> = {
    ...Widget.defaultProps,
    id: 'toast',
    placement: 'bottom-right',
    showBorder: false
  };

  className = TOAST_WIDGET_CLASS;
  placement: WidgetPlacement = 'bottom-right';
  showBorder = false;
  #unsubscriber: () => void = () => {};
  #toasts: ReadonlyArray<ToastEntry> = [];
  #rootElement: HTMLElement | null = null;

  constructor(props: ToastWidgetProps = {}) {
    super(props);
    this.setProps(this.props);
  }

  setProps(props: Partial<ToastWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.showBorder !== undefined) {
      this.showBorder = props.showBorder;
    }

    super.setProps(props);
  }

  onAdd() {
    this.#unsubscriber();
    this.#unsubscriber = toastManager.subscribe((toasts) => {
      this.#toasts = toasts;
      if (this.#rootElement) {
        render(
          <ToastWidgetView toasts={this.#toasts} showBorder={this.showBorder} />,
          this.#rootElement
        );
      }
    });
  }

  onRemove(): void {
    this.#unsubscriber();
    this.#unsubscriber = () => {};
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.className = className;
    rootElement.style.pointerEvents = 'auto';
    rootElement.style.position = 'absolute';
    rootElement.style.width = '360px';
    rootElement.style.maxWidth = 'calc(100vw - 24px)';
    rootElement.style.top = '';
    rootElement.style.right = '';
    rootElement.style.bottom = '';
    rootElement.style.left = '';

    if (this.placement.includes('top')) {
      rootElement.style.top = '0px';
    } else {
      rootElement.style.bottom = '0px';
    }

    if (this.placement.includes('right')) {
      rootElement.style.right = '0px';
    } else {
      rootElement.style.left = '0px';
    }

    this.#toasts = toastManager.getToasts();
    render(<ToastWidgetView toasts={this.#toasts} showBorder={this.showBorder} />, rootElement);
  }
}
