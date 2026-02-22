/** @jsxImportSource preact */
import type { JSX } from 'preact';

export function makeTextIcon(content: string, fontSize = 16, viewBoxSize = 24): string {
  const halfViewBoxSize = viewBoxSize / 2;

  return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${halfViewBoxSize} -${halfViewBoxSize} ${viewBoxSize} ${viewBoxSize}" ><text text-anchor="middle" alignment-baseline="middle" font-family="sans-serif" font-size="${fontSize}">${content}</text></svg>`;
}

export function IconButton({
  icon,
  color,
  style,
  className = '',
  title,
  onClick,
}: {
  icon: string;
  color?: string;
  className?: string;
  style?: JSX.CSSProperties;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <div className={`deck-widget-button ${className}`} style={style}>
      <button className="deck-widget-icon-button" type="button" title={title} onClick={onClick}>
        <div
          className="deck-widget-icon"
          style={{
            backgroundColor: color,
            maskImage: `url('${icon}')`,
          }}
        />
      </button>
    </div>
  );
}
