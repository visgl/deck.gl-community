// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {useLayoutEffect, useState} from 'preact/hooks';

/** Keep floating controls inside their native or fallback fullscreen host. */
export function usePanelPortalTarget(
  anchor: {current: HTMLElement | null},
  open: boolean
): HTMLElement | null {
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    const document = anchor.current?.ownerDocument;
    if (!open || !document) return undefined;
    const update = () => refresh(value => value + 1);
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('deck-panel-fullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('deck-panel-fullscreenchange', update);
    };
  }, [anchor, open]);
  const element = anchor.current;
  if (!element) return null;
  const fallback = element.closest<HTMLElement>('[data-deck-panel-fullscreen="fallback"]');
  const native = element.ownerDocument.fullscreenElement;
  return (
    fallback ??
    (native instanceof HTMLElement && native.contains(element)
      ? native
      : element.ownerDocument.body)
  );
}
