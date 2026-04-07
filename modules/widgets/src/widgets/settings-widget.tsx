/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';

import {SettingsPanelContent} from '../widget-panels/settings-panel';
import {IconButton, makeTextIcon} from '../widget-components/icon-button';

import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {JSX} from 'preact';

export type SettingsWidgetValue = boolean | number | string;

export type SettingsWidgetSettingType = 'boolean' | 'number' | 'string' | 'select';

export type SettingsWidgetOption =
  | SettingsWidgetValue
  | {
      label: string;
      value: SettingsWidgetValue;
    };

export type SettingsWidgetSettingDescriptor = {
  /** Path in the settings object (dot notation supported). */
  name: string;
  /** Human-friendly label shown in the control list. Defaults to `name`. */
  label?: string;
  description?: string;
  type: SettingsWidgetSettingType;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingsWidgetOption[];
  defaultValue?: SettingsWidgetValue;
};

export type SettingsWidgetSectionDescriptor = {
  /** Optional stable id for preserving collapse state across re-renders. */
  id?: string;
  name: string;
  description?: string;
  /** Whether this section starts collapsed when first seen. Defaults to true. */
  initiallyCollapsed?: boolean;
  settings: SettingsWidgetSettingDescriptor[];
};

export type SettingsWidgetSchema = {
  title?: string;
  sections: SettingsWidgetSectionDescriptor[];
};

export type SettingsWidgetState = Record<string, unknown>;

export type SettingsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  label?: string;
  schema?: SettingsWidgetSchema;
  settings?: SettingsWidgetState;
  onSettingsChange?: (settings: SettingsWidgetState) => void;
};

const PANE_STYLE: JSX.CSSProperties & Record<string, string | number> = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  width: '380px',
  maxHeight: 'min(460px, calc(100vh - 60px))',
  borderRadius: '8px',
  border: '1px solid rgba(71, 85, 105, 0.55)',
  background: 'rgba(15, 23, 42, 0.94)',
  color: 'rgba(241, 245, 249, 0.98)',
  boxShadow: '0 12px 32px rgba(2, 6, 23, 0.55)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  pointerEvents: 'auto',
  zIndex: 20,
  '--button-background': 'rgba(30, 41, 59, 0.92)',
  '--button-background-hover': 'rgba(15, 23, 42, 0.9)',
  '--button-inner-stroke': '1px solid rgba(100, 116, 139, 0.72)',
  '--button-corner-radius': '8px',
  '--button-text': 'rgba(241, 245, 249, 0.98)',
  '--button-icon-idle': 'rgba(203, 213, 225, 0.92)',
  '--button-icon-hover': 'rgba(125, 211, 252, 0.98)',
  '--button-backdrop-filter': 'blur(10px)',
  '--container-background': 'rgba(15, 23, 42, 0.98)',
  '--menu-item-hover': 'rgba(51, 65, 85, 0.82)'
};

const HEADER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(100, 116, 139, 0.45)',
  padding: '10px 12px'
};

const SETTINGS_BUTTON_ICON = makeTextIcon('⚙', 24, 36);

function stopPropagation(event: Event) {
  event.stopPropagation();
}

type SettingsWidgetViewProps = {
  label: string;
  schema: SettingsWidgetSchema;
  settings: SettingsWidgetState;
  onSettingsChange?: (settings: SettingsWidgetState) => void;
};

const DEFAULT_SETTINGS_WIDGET_SCHEMA: SettingsWidgetSchema = {sections: []};
const DEFAULT_SETTINGS_WIDGET_STATE: SettingsWidgetState = {};

function SettingsWidgetView({label, schema, settings, onSettingsChange}: SettingsWidgetViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);

  useEffect(() => {
    if (isPaneOpen && typeof document !== 'undefined') {
      const handleDocumentPointerDown = (event: PointerEvent) => {
        if (!containerRef.current || !event.target) {
          return;
        }
        if (!containerRef.current.contains(event.target as Node)) {
          setIsPaneOpen(false);
        }
      };

      document.addEventListener('pointerdown', handleDocumentPointerDown);
      return () => {
        document.removeEventListener('pointerdown', handleDocumentPointerDown);
      };
    }

    return undefined;
  }, [isPaneOpen]);

  return (
    <div ref={containerRef} style={{position: 'relative', pointerEvents: 'auto'}}>
      <IconButton
        icon={SETTINGS_BUTTON_ICON}
        title={label}
        className={isPaneOpen ? 'deck-widget-button-active' : ''}
        onClick={() => setIsPaneOpen((previous) => !previous)}
      />

      {isPaneOpen && (
        <div
          role="dialog"
          aria-label={schema.title ?? label}
          style={PANE_STYLE}
          onPointerDown={(event) => stopPropagation(event as unknown as Event)}
          onMouseDown={(event) => stopPropagation(event as unknown as Event)}
          onWheel={(event) => stopPropagation(event as unknown as Event)}
          onClick={(event) => stopPropagation(event as unknown as Event)}
        >
          <div style={HEADER_STYLE}>
            <div style={{fontSize: '13px', fontWeight: 700}}>{schema.title ?? label}</div>
            <button
              type="button"
              onClick={() => setIsPaneOpen(false)}
              style={{
                border: 0,
                borderRadius: '4px',
                padding: '2px 6px',
                background: 'rgba(51, 65, 85, 0.8)',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '14px',
                lineHeight: 1
              }}
              title="Close settings"
              aria-label="Close settings"
            >
              ×
            </button>
          </div>

          <SettingsPanelContent
            schema={schema}
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        </div>
      )}
    </div>
  );
}

export class SettingsWidget extends Widget<SettingsWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'settings',
    placement: 'top-left',
    label: 'Settings',
    schema: DEFAULT_SETTINGS_WIDGET_SCHEMA,
    settings: DEFAULT_SETTINGS_WIDGET_STATE,
    onSettingsChange: undefined
  } satisfies Required<WidgetProps> &
    Required<Pick<SettingsWidgetProps, 'placement' | 'label' | 'schema' | 'settings'>> &
    SettingsWidgetProps;

  className = 'deck-widget-settings';
  placement: WidgetPlacement = SettingsWidget.defaultProps.placement;

  #label = SettingsWidget.defaultProps.label;
  #schema = SettingsWidget.defaultProps.schema;
  #settings = SettingsWidget.defaultProps.settings;
  #onSettingsChange: SettingsWidgetProps['onSettingsChange'] =
    SettingsWidget.defaultProps.onSettingsChange;
  #rootElement: HTMLElement | null = null;

  constructor(props: SettingsWidgetProps = {}) {
    super({...SettingsWidget.defaultProps, ...props});

    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.label !== undefined) {
      this.#label = props.label;
    }
    if (props.schema !== undefined) {
      this.#schema = props.schema;
    }
    if (props.settings !== undefined) {
      this.#settings = props.settings;
    }
    if (props.onSettingsChange !== undefined) {
      this.#onSettingsChange = props.onSettingsChange;
    }
  }

  override setProps(props: Partial<SettingsWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.label !== undefined) {
      this.#label = props.label;
    }
    if (props.schema !== undefined) {
      this.#schema = props.schema;
    }
    if (props.settings !== undefined) {
      this.#settings = props.settings;
    }
    if (props.onSettingsChange !== undefined) {
      this.#onSettingsChange = props.onSettingsChange;
    }
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;

    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');

    rootElement.className = className;

    render(
      <SettingsWidgetView
        label={this.#label}
        schema={this.#schema}
        settings={this.#settings}
        onSettingsChange={this.#onSettingsChange}
      />,
      rootElement
    );
  }

  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }
}
