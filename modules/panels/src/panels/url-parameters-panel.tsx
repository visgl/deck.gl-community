/** @jsxImportSource preact */

import type {URLParameter} from '../lib/url-parameters/url-parameters';
import type {Panel, PanelTheme} from './panel-containers';
import type {JSX} from 'preact';

/**
 * Props used to construct the URL-parameter help panel.
 */
export type URLParametersPanelProps = {
  /** URL parameters documented for the current view. */
  urlParameters?: readonly URLParameter[];
  /** Optional theme override. */
  theme?: PanelTheme;
};

/**
 * A panel definition that renders supported URL query parameters for deep links.
 */
export class URLParametersPanel implements Panel {
  /** Stable panel id used by tab containers. */
  id = 'url-parameters';
  /** Visible tab title. */
  title = 'URL Deep Links';
  /** Optional panel theme override. */
  theme?: PanelTheme;
  /** Renderable panel content. */
  content: JSX.Element;

  /**
   * Creates a URL parameter help panel.
   */
  constructor({urlParameters = [], theme = 'inherit'}: URLParametersPanelProps = {}) {
    this.theme = theme;
    this.content = <URLParametersPanelContent urlParameters={urlParameters} />;
  }
}

/**
 * Renders each documented URL parameter with canonical and legacy names.
 */
export function URLParametersPanelContent({
  urlParameters
}: {
  /** URL parameters rendered in insertion order. */
  urlParameters: readonly URLParameter[];
}) {
  if (urlParameters.length === 0) {
    return (
      <div style={EMPTY_STATE_STYLE}>
        <strong>No URL parameters are documented for this view.</strong>
        <span>Deep-link parameters are not currently configured.</span>
      </div>
    );
  }

  return (
    <div style={PARAMETER_PANEL_STYLE}>
      <p style={URL_PARAMS_HELP_TEXT_STYLE}>
        These URL parameters control deep links for this view.
      </p>
      {urlParameters.map((parameter, index) => (
        <div key={parameter.name} style={PARAMETER_ROW_STYLE}>
          <div style={PARAMETER_ROW_HEADER_STYLE}>
            <span style={PARAMETER_NAME_STYLE}>
              {formatParameterExample(parameter.name, index)}
            </span>
            <span style={PARAMETER_DESCRIPTION_STYLE}>{parameter.description}</span>
          </div>
          {legacyNameLabels(parameter.legacyNames) ? (
            <div style={PARAMETER_LEGACY_STYLE}>
              Legacy: {legacyNameLabels(parameter.legacyNames)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function legacyNameLabels(legacyNames: readonly string[] | undefined): string | null {
  if (!legacyNames || legacyNames.length === 0) {
    return null;
  }
  return legacyNames.join(', ');
}

function formatParameterExample(name: string, index: number): string {
  const prefix = index === 0 ? '?' : '&';
  return `${prefix}${name}=${formatParameterPlaceholder(name)}`;
}

function formatParameterPlaceholder(name: string): string {
  if (name.endsWith('Ids')) {
    const singularName = name.slice(0, -3);
    return `<${singularName}-id-1>,<${singularName}-id-2>,...`;
  }
  return `<${name}-value>`;
}

const PARAMETER_PANEL_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '10px',
  padding: '8px'
};

const URL_PARAMS_HELP_TEXT_STYLE: JSX.CSSProperties = {
  margin: 0,
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '17px'
};

const PARAMETER_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.42))',
  background:
    'linear-gradient(90deg, rgba(248, 250, 252, 0.94), rgba(255, 255, 255, 0.98) 40%, var(--menu-background, #fff))'
};

const PARAMETER_ROW_HEADER_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '2px'
};

const PARAMETER_NAME_STYLE: JSX.CSSProperties = {
  fontSize: '13px',
  lineHeight: '16px',
  fontWeight: 700,
  fontFamily: 'var(--menu-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas)'
};

const PARAMETER_DESCRIPTION_STYLE: JSX.CSSProperties = {
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '16px'
};

const PARAMETER_LEGACY_STYLE: JSX.CSSProperties = {
  color: 'var(--menu-icon-idle, rgb(71, 85, 105))',
  fontSize: '11px',
  lineHeight: '14px'
};

const EMPTY_STATE_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  padding: '12px',
  color: 'var(--menu-icon-idle, rgb(71, 85, 105))',
  fontSize: '12px',
  lineHeight: '16px'
};
