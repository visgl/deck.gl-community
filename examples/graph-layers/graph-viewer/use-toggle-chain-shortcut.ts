// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useEffect} from 'react';

import type {D3DagLayout} from '@deck.gl-community/graph-layers';

import {isEditableElement} from './node-classification';
import {TOGGLE_CHAIN_SHORTCUT} from './shortcuts';

type DagChainSummary = {chainIds: string[]; collapsedIds: string[]};

type UseToggleChainShortcutProps = {
  enabled: boolean;
  layout: D3DagLayout | null;
  summary: DagChainSummary | null;
  focusedChainId: string | null;
};

const TOGGLE_CHAIN_SHORTCUT_KEY = TOGGLE_CHAIN_SHORTCUT.key.toLowerCase();

export function useToggleChainShortcut({
  enabled,
  layout,
  summary,
  focusedChainId
}: UseToggleChainShortcutProps): void {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return () => undefined;
    }
    if (!enabled || !layout) {
      return () => undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== TOGGLE_CHAIN_SHORTCUT_KEY) {
        return;
      }
      if (isEditableElement(event.target)) {
        return;
      }
      const availableChainIds = summary?.chainIds ?? [];
      if (availableChainIds.length === 0) {
        return;
      }

      const activeChainId =
        focusedChainId && availableChainIds.includes(focusedChainId)
          ? focusedChainId
          : availableChainIds[0] ?? null;

      if (!activeChainId) {
        return;
      }

      layout.toggleCollapsedChain(activeChainId);
      event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, layout, summary, focusedChainId]);
}
