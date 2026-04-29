/** @jsxImportSource preact */

import type {Panel, PanelTheme} from './panel-containers';
import type {JSX} from 'preact';

/**
 * User-facing documentation link rendered in a help panel.
 */
export type DocumentationLink = {
  /** Entry kind. Defaults to a clickable link when omitted. */
  kind?: 'link';
  /** Stable link id used as a render key. */
  id: string;
  /** Visible link title. */
  title: string;
  /** Link target URL. */
  href: string;
  /** Optional short description shown under the title. */
  description?: string;
  /** Optional badge shown next to the title. */
  badge?: string;
};

/**
 * Spacer entry rendered between documentation link groups.
 */
export type DocumentationLinkSpacer = {
  /** Entry kind used to render vertical space instead of a link. */
  kind: 'spacer';
  /** Stable spacer id used as a render key. */
  id: string;
};

/**
 * Documentation panel item, either a clickable link or visual group spacer.
 */
export type DocumentationLinkItem = DocumentationLink | DocumentationLinkSpacer;

/**
 * Props used to construct a documentation links panel.
 */
export type DocumentationLinksPanelProps = {
  /** Documentation links rendered in insertion order. */
  links?: readonly DocumentationLinkItem[];
  /** Optional panel theme override. */
  theme?: PanelTheme;
};

/**
 * A panel definition that renders documentation and resource links.
 */
export class DocumentationLinksPanel implements Panel {
  /** Stable id used by tab containers. */
  id = 'documentation-links';
  /** Visible tab title. */
  title = 'Documentation';
  /** Optional panel theme override. */
  theme?: PanelTheme;
  /** Renderable panel body. */
  content: JSX.Element;

  /**
   * Creates a documentation links panel.
   */
  constructor({links = [], theme = 'inherit'}: DocumentationLinksPanelProps = {}) {
    this.theme = theme;
    this.content = <DocumentationLinksPanelContent links={links} />;
  }
}

/**
 * Renders documentation links or an empty state.
 */
export function DocumentationLinksPanelContent({
  links
}: {
  /** Documentation links rendered in insertion order. */
  links: readonly DocumentationLinkItem[];
}) {
  if (links.length === 0) {
    return (
      <div style={EMPTY_STATE_STYLE}>
        <strong>No documentation links configured.</strong>
        <span>Pass documentation links to populate this tab.</span>
      </div>
    );
  }

  let groupIndex = 0;
  return (
    <div style={LINK_LIST_STYLE}>
      <div style={DOCUMENTATION_INTRO_STYLE}>
        <strong>Documentation and related resources.</strong>
        <span>Use these links to open more context outside the help dialog.</span>
      </div>
      {links.map(link => {
        if (link.kind === 'spacer') {
          groupIndex += 1;
          return <div key={link.id} aria-hidden="true" style={LINK_SPACER_STYLE} />;
        }

        const accent = LINK_CARD_ACCENTS[groupIndex % LINK_CARD_ACCENTS.length];
        return (
          <a
            key={link.id}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            style={makeLinkCardStyle(accent)}
          >
            <span style={LINK_TITLE_ROW_STYLE}>
              <span style={LINK_TITLE_STYLE}>{link.title}</span>
              <span style={makeLinkBadgeStyle(accent)}>{link.badge ?? 'Open'}</span>
            </span>
            {link.description ? (
              <span style={LINK_DESCRIPTION_STYLE}>{link.description}</span>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

const LINK_LIST_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '10px'
};

const DOCUMENTATION_INTRO_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  padding: '4px 2px 6px',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '16px'
};

const LINK_CARD_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  padding: '14px 16px',
  borderRadius: 'var(--button-corner-radius, 8px)',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.42))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.055)',
  textDecoration: 'none'
};

const LINK_CARD_ACCENTS = [
  {
    borderLeft: '5px solid rgba(37, 99, 235, 0.72)',
    background:
      'linear-gradient(90deg, rgba(239, 246, 255, 0.95), rgba(255, 255, 255, 0.98) 38%, var(--menu-background, #fff))',
    badgeBorder: '1px solid rgba(37, 99, 235, 0.24)',
    badgeColor: 'rgb(37, 99, 235)',
    badgeBackgroundColor: 'rgba(219, 234, 254, 0.72)'
  },
  {
    borderLeft: '5px solid rgba(20, 184, 166, 0.72)',
    background:
      'linear-gradient(90deg, rgba(240, 253, 250, 0.95), rgba(255, 255, 255, 0.98) 38%, var(--menu-background, #fff))',
    badgeBorder: '1px solid rgba(20, 184, 166, 0.26)',
    badgeColor: 'rgb(15, 118, 110)',
    badgeBackgroundColor: 'rgba(204, 251, 241, 0.7)'
  },
  {
    borderLeft: '5px solid rgba(245, 158, 11, 0.72)',
    background:
      'linear-gradient(90deg, rgba(255, 251, 235, 0.95), rgba(255, 255, 255, 0.98) 38%, var(--menu-background, #fff))',
    badgeBorder: '1px solid rgba(245, 158, 11, 0.3)',
    badgeColor: 'rgb(180, 83, 9)',
    badgeBackgroundColor: 'rgba(254, 243, 199, 0.72)'
  }
] as const;

const LINK_TITLE_ROW_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px'
};

const LINK_TITLE_STYLE: JSX.CSSProperties = {
  fontSize: '16px',
  lineHeight: '22px',
  fontWeight: 750
};

const LINK_DESCRIPTION_STYLE: JSX.CSSProperties = {
  color: 'var(--button-icon-idle, rgb(71, 85, 105))',
  fontSize: '12px',
  lineHeight: '16px'
};

const LINK_BADGE_STYLE: JSX.CSSProperties = {
  borderRadius: '999px',
  padding: '2px 8px',
  fontSize: '10px',
  lineHeight: '13px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0'
};

const LINK_SPACER_STYLE: JSX.CSSProperties = {
  height: '12px'
};

const EMPTY_STATE_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  padding: '12px',
  color: 'var(--button-icon-idle, rgb(71, 85, 105))',
  fontSize: '12px',
  lineHeight: '16px'
};

function makeLinkCardStyle(accent: (typeof LINK_CARD_ACCENTS)[number]): JSX.CSSProperties {
  return {
    ...LINK_CARD_STYLE,
    borderLeft: accent.borderLeft,
    background: accent.background
  };
}

function makeLinkBadgeStyle(accent: (typeof LINK_CARD_ACCENTS)[number]): JSX.CSSProperties {
  return {
    ...LINK_BADGE_STYLE,
    border: accent.badgeBorder,
    color: accent.badgeColor,
    backgroundColor: accent.badgeBackgroundColor
  };
}
