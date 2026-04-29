/** @jsxImportSource preact */

import type {ShortcutDisplayIcon} from '../keyboard-shortcuts/keyboard-shortcuts';
import type {JSX} from 'preact';

/**
 * Renders a compact interaction glyph for help-panel input chips.
 */
export function InteractionIcon({
  icon
}: {
  /** Icon variant to render. */ icon: ShortcutDisplayIcon;
}) {
  if (icon === 'trackpad-click') {
    return <TrackpadClickIcon />;
  }
  if (icon === 'trackpad-pan') {
    return <TrackpadPanIcon />;
  }
  if (icon === 'trackpad-zoom') {
    return <TrackpadZoomIcon />;
  }
  if (icon === 'mouse-drag') {
    return <MouseDragIcon />;
  }
  return <KeyboardIcon />;
}

function InteractionSvg({
  children,
  label
}: {
  /** Accessible label for the icon. */
  label: string;
  /** SVG children rendered inside the icon frame. */
  children: JSX.Element | JSX.Element[];
}) {
  return (
    <svg
      aria-label={label}
      role="img"
      width="22"
      height="18"
      viewBox="0 0 22 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{flex: '0 0 auto'}}
    >
      {children}
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <InteractionSvg label="Keyboard">
      <rect x="2.25" y="4.25" width="17.5" height="9.5" rx="2" stroke="currentColor" />
      <path
        d="M5 7.5h1.5M8.5 7.5H10M12 7.5h1.5M15.5 7.5H17M5 10.5h12"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </InteractionSvg>
  );
}

function MouseDragIcon() {
  return (
    <InteractionSvg label="Mouse drag">
      <rect x="7" y="2.5" width="8" height="13" rx="4" stroke="currentColor" />
      <path d="M11 2.5v4M4 9h3M15 9h3" stroke="currentColor" strokeLinecap="round" />
      <path
        d="M17 7.5l1.5 1.5L17 10.5M5 7.5L3.5 9 5 10.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </InteractionSvg>
  );
}

function TrackpadPanIcon() {
  return (
    <InteractionSvg label="Trackpad pan">
      <rect x="2.5" y="4.5" width="17" height="10" rx="2.5" stroke="currentColor" />
      <path
        d="M7 9.5h8M13 7.5l2 2-2 2M9 7.5l-2 2 2 2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </InteractionSvg>
  );
}

function TrackpadClickIcon() {
  return (
    <InteractionSvg label="Trackpad click">
      <rect x="2.5" y="4.5" width="17" height="10" rx="2.5" stroke="currentColor" />
      <circle cx="11" cy="9.5" r="2" stroke="currentColor" />
      <path d="M11 2.5v2M11 14.5v1" stroke="currentColor" strokeLinecap="round" />
    </InteractionSvg>
  );
}

function TrackpadZoomIcon() {
  return (
    <InteractionSvg label="Trackpad zoom">
      <rect x="2.5" y="4.5" width="17" height="10" rx="2.5" stroke="currentColor" />
      <path
        d="M8 10.5l-2 2M6.25 12.5H8M6.25 12.5V10.75M14 6.5l2-2M15.75 4.5H14M15.75 4.5V6.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="11" cy="9.5" r="1" fill="currentColor" />
    </InteractionSvg>
  );
}
