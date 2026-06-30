import type {JSX} from 'preact';

/** Return true when a trigger icon should be rendered as a CSS mask image. */
export function isMaskIcon(icon: string): boolean {
  return icon.startsWith('data:') || icon.startsWith('http:') || icon.startsWith('https:');
}

/** Return CSS mask image styles for a data or remote trigger icon. */
export function getMaskIconStyle(icon: string, color: string): JSX.CSSProperties {
  const maskImage = `url(${JSON.stringify(icon)})`;

  return {
    display: 'block',
    width: '16px',
    height: '16px',
    backgroundColor: color,
    maskImage,
    WebkitMaskImage: maskImage,
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskSize: 'contain',
    WebkitMaskSize: 'contain'
  };
}
