/** @jsxImportSource preact */
import {Panel} from '../../panels/panel';
import type {PanelProps} from '../../panels/panel';

import type {ComponentChildren, JSX} from 'preact';
import type {PanelTheme} from '../../panels/panel';

/** Props for a markdown-backed panel definition. */
export type MarkdownPanelProps = PanelProps & {
  id?: string;
  title: string;
  markdown: string;
  disabled?: boolean;
  keepMounted?: boolean;
  className?: string;
  theme?: PanelTheme;
};

/** Panel definition that renders the supported markdown subset into panel content. */
export class MarkdownPanel extends Panel<MarkdownPanelProps> {
  /** Default identity, overridable when mounting multiple instances. */
  static defaultProps = {...Panel.defaultProps, id: 'markdown-panel'};

  /** Renders content from the current public props. */
  override renderContent() {
    const {markdown, className} = this.props;
    return (
      <div className={className} style={MARKDOWN_PANEL_STYLE}>
        {renderMarkdownBlocks(markdown)}
      </div>
    );
  }
}

/* eslint-disable max-statements, no-continue */
function renderMarkdownBlocks(markdown: string): JSX.Element[] {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, '\n');
  const lines = normalizedMarkdown.split('\n');
  const blocks: JSX.Element[] = [];
  const paragraphLines: string[] = [];
  const unorderedListItems: string[] = [];
  const orderedListItems: string[] = [];
  let fencedCodeLines: string[] | undefined;
  let blockIndex = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const paragraphText = paragraphLines.join(' ');
    const currentBlockKey = `paragraph-${blockIndex++}`;
    blocks.push(
      <p key={currentBlockKey} style={MARKDOWN_PARAGRAPH_STYLE}>
        {renderInlineMarkdown(paragraphText, currentBlockKey)}
      </p>
    );
    paragraphLines.length = 0;
  };

  const flushUnorderedList = () => {
    if (unorderedListItems.length === 0) {
      return;
    }
    const currentBlockIndex = blockIndex++;
    blocks.push(
      <ul key={`unordered-list-${currentBlockIndex}`} style={MARKDOWN_LIST_STYLE}>
        {unorderedListItems.map((item, itemIndex) => (
          <li
            key={`unordered-item-${currentBlockIndex}-${itemIndex}`}
            style={MARKDOWN_LIST_ITEM_STYLE}
          >
            {renderInlineMarkdown(item, `unordered-item-${currentBlockIndex}-${itemIndex}`)}
          </li>
        ))}
      </ul>
    );
    unorderedListItems.length = 0;
  };

  const flushOrderedList = () => {
    if (orderedListItems.length === 0) {
      return;
    }
    const currentBlockIndex = blockIndex++;
    blocks.push(
      <ol key={`ordered-list-${currentBlockIndex}`} style={MARKDOWN_LIST_STYLE}>
        {orderedListItems.map((item, itemIndex) => (
          <li
            key={`ordered-item-${currentBlockIndex}-${itemIndex}`}
            style={MARKDOWN_LIST_ITEM_STYLE}
          >
            {renderInlineMarkdown(item, `ordered-item-${currentBlockIndex}-${itemIndex}`)}
          </li>
        ))}
      </ol>
    );
    orderedListItems.length = 0;
  };

  const flushFencedCodeBlock = () => {
    if (fencedCodeLines === undefined) {
      return;
    }
    blocks.push(
      <pre key={`code-${blockIndex++}`} style={MARKDOWN_CODE_BLOCK_STYLE}>
        <code>{fencedCodeLines.join('\n')}</code>
      </pre>
    );
    fencedCodeLines = undefined;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (fencedCodeLines !== undefined) {
      if (trimmedLine.startsWith('```')) {
        flushFencedCodeBlock();
      } else {
        fencedCodeLines.push(line);
      }
      continue;
    }
    if (trimmedLine.startsWith('```')) {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();
      fencedCodeLines = [];
      continue;
    }
    if (trimmedLine.length === 0) {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();
      continue;
    }
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushUnorderedList();
      flushOrderedList();
      const headingLevel = headingMatch[1].length;
      const headingText = headingMatch[2];
      const HeadingTag = `h${headingLevel}` as keyof JSX.IntrinsicElements;
      const currentBlockKey = `heading-${blockIndex++}`;
      blocks.push(
        <HeadingTag key={currentBlockKey} style={getMarkdownHeadingStyle(headingLevel)}>
          {renderInlineMarkdown(headingText, currentBlockKey)}
        </HeadingTag>
      );
      continue;
    }
    const unorderedListMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (unorderedListMatch) {
      flushParagraph();
      flushOrderedList();
      unorderedListItems.push(unorderedListMatch[1]);
      continue;
    }
    const orderedListMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
    if (orderedListMatch) {
      flushParagraph();
      flushUnorderedList();
      orderedListItems.push(orderedListMatch[1]);
      continue;
    }
    paragraphLines.push(trimmedLine);
  }

  flushParagraph();
  flushUnorderedList();
  flushOrderedList();
  flushFencedCodeBlock();
  return blocks;
}

function renderInlineMarkdown(source: string, keyPrefix: string): ComponentChildren[] {
  const inlineTokenPattern =
    /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  const children: ComponentChildren[] = [];
  let match: RegExpExecArray | null;
  let previousIndex = 0;
  let tokenIndex = 0;

  for (match = inlineTokenPattern.exec(source); match; match = inlineTokenPattern.exec(source)) {
    if (match.index > previousIndex) {
      children.push(source.slice(previousIndex, match.index));
    }
    if (match[2] !== undefined && match[3] !== undefined) {
      children.push(
        <a
          key={`${keyPrefix}-link-${tokenIndex}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          style={MARKDOWN_LINK_STYLE}
        >
          {match[2]}
        </a>
      );
    } else if (match[4] !== undefined) {
      children.push(
        <code key={`${keyPrefix}-code-${tokenIndex}`} style={MARKDOWN_INLINE_CODE_STYLE}>
          {match[4]}
        </code>
      );
    } else if (match[5] !== undefined || match[6] !== undefined) {
      children.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`}>{match[5] ?? match[6]}</strong>
      );
    } else if (match[7] !== undefined || match[8] !== undefined) {
      children.push(<em key={`${keyPrefix}-em-${tokenIndex}`}>{match[7] ?? match[8]}</em>);
    }
    previousIndex = match.index + match[0].length;
    tokenIndex += 1;
  }

  if (previousIndex < source.length) {
    children.push(source.slice(previousIndex));
  }
  return children.length === 0 ? [source] : children;
}
/* eslint-enable max-statements, no-continue */

function getMarkdownHeadingStyle(level: number): JSX.CSSProperties {
  if (level === 1) {
    return MARKDOWN_HEADING_1_STYLE;
  }
  if (level === 2) {
    return MARKDOWN_HEADING_2_STYLE;
  }
  if (level === 3) {
    return MARKDOWN_HEADING_3_STYLE;
  }
  return MARKDOWN_HEADING_4_TO_6_STYLE;
}

const MARKDOWN_PANEL_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--panel-gap, 12px)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: 'var(--panel-font-size, 13px)',
  lineHeight: '1.5'
};

const MARKDOWN_PARAGRAPH_STYLE: JSX.CSSProperties = {margin: '0'};

const MARKDOWN_LIST_STYLE: JSX.CSSProperties = {
  margin: '0',
  paddingLeft: '18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--panel-gap, 6px)'
};

const MARKDOWN_LIST_ITEM_STYLE: JSX.CSSProperties = {margin: '0'};

const MARKDOWN_CODE_BLOCK_STYLE: JSX.CSSProperties = {
  margin: '0',
  padding: 'var(--panel-padding, 10px 12px)',
  borderRadius: 'var(--panel-corner-radius, 8px)',
  overflowX: 'auto',
  background: 'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  border: '1px solid var(--menu-border-color, var(--menu-border, rgba(148, 163, 184, 0.2)))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: 'var(--panel-font-size, 12px)',
  lineHeight: '1.45'
};

const MARKDOWN_INLINE_CODE_STYLE: JSX.CSSProperties = {
  padding: 'var(--panel-padding, 1px 5px)',
  borderRadius: 'var(--panel-corner-radius, 4px)',
  background: 'var(--menu-weak-background, var(--button-background, var(--menu-background, #fff)))',
  border: '1px solid var(--menu-border-color, var(--menu-border, rgba(148, 163, 184, 0.2)))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: 'var(--panel-font-size, 12px)'
};

const MARKDOWN_LINK_STYLE: JSX.CSSProperties = {
  color: 'var(--button-text, rgb(29, 78, 216))'
};

const MARKDOWN_HEADING_1_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: 'var(--panel-font-size, 20px)',
  fontWeight: 700,
  lineHeight: '1.25'
};

const MARKDOWN_HEADING_2_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: 'var(--panel-font-size, 17px)',
  fontWeight: 700,
  lineHeight: '1.3'
};

const MARKDOWN_HEADING_3_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: 'var(--panel-font-size, 15px)',
  fontWeight: 700,
  lineHeight: '1.35'
};

const MARKDOWN_HEADING_4_TO_6_STYLE: JSX.CSSProperties = {
  margin: '0',
  fontSize: 'var(--panel-font-size, 13px)',
  fontWeight: 700,
  lineHeight: '1.4'
};
