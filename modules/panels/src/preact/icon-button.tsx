/** @jsxImportSource preact */
// Ported from deck.gl-community/modules/widgets/src/widget-components/icon-button.tsx.

import type {JSX} from 'preact';

/**
 * Stops widget button events from leaking into the deck canvas interaction layer.
 */
function stopPropagation(event: Event): void {
  event.stopPropagation();
}

/**
 * Creates a data URI SVG icon from a text glyph.
 */
export function makeTextIcon(content: string, fontSize = 16, viewBoxSize = 24): string {
  const halfViewBoxSize = viewBoxSize / 2;

  return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${halfViewBoxSize} -${halfViewBoxSize} ${viewBoxSize} ${viewBoxSize}" ><text text-anchor="middle" alignment-baseline="middle" font-family="sans-serif" font-size="${fontSize}">${content}</text></svg>`;
}

/**
 * Renders a deck widget icon button using deck.gl widget chrome classes.
 */
export function IconButton({
  icon,
  color,
  style,
  buttonStyle,
  iconStyle,
  className = '',
  ariaLabel,
  title,
  onClick
}: {
  /** Mask-image icon data URI. */
  icon: string;
  /** Optional mask fill color. */
  color?: string;
  /** Optional class name applied to the button wrapper. */
  className?: string;
  /** Optional inline style applied to the button wrapper. */
  style?: JSX.CSSProperties;
  /** Optional inline style applied to the native button. */
  buttonStyle?: JSX.CSSProperties;
  /** Optional inline style applied to the masked icon. */
  iconStyle?: JSX.CSSProperties;
  /** Optional accessible label for buttons without native title text. */
  ariaLabel?: string;
  /** Optional button title and tooltip text. */
  title?: string;
  /** Optional click handler invoked when the button is pressed. */
  onClick?: () => void;
}) {
  return (
    <div className={`deck-widget-button ${className}`} style={style}>
      <button
        aria-label={ariaLabel ?? title}
        className="deck-widget-icon-button"
        type="button"
        title={title}
        style={buttonStyle}
        onPointerDown={stopPropagation}
        onPointerUp={stopPropagation}
        onClick={event => {
          event.stopPropagation();
          onClick?.();
        }}
        onDblClick={stopPropagation}
      >
        <div
          className="deck-widget-icon"
          style={{
            backgroundColor: color,
            maskImage: `url('${icon}')`,
            ...iconStyle
          }}
        />
      </button>
    </div>
  );
}
