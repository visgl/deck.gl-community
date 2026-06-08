import {useCallback, useEffect, useState} from 'preact/hooks';

import type {PanelId} from './panel';

/**
 * Keeps local string-state in sync with controlled/uncontrolled props.
 */
export function useControlledStringState(
  controlledValue?: PanelId,
  defaultValue?: PanelId
): [PanelId | undefined, (next: PanelId | undefined) => void] {
  const [internalValue, setInternalValue] = useState<PanelId | undefined>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const resolvedValue = isControlled ? controlledValue : internalValue;

  useEffect(() => {
    if (!isControlled) {
      return;
    }
    setInternalValue(controlledValue);
  }, [isControlled, controlledValue]);

  const setValue = useCallback(
    (next: PanelId | undefined) => {
      if (!isControlled) {
        setInternalValue(next);
      }
    },
    [isControlled]
  );

  return [resolvedValue, setValue];
}

/**
 * Normalizes panel id collections for deterministic membership checks and stable state.
 */
function normalizePanelIds(values: ReadonlyArray<PanelId> | undefined): ReadonlyArray<PanelId> {
  if (!values || values.length === 0) {
    return [];
  }
  const deduped: PanelId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = String(value);
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      deduped.push(trimmed);
    }
  }
  return deduped;
}

/**
 * Keeps local list state in sync with controlled/uncontrolled props.
 */
export function useControlledStringListState(
  controlledValue?: ReadonlyArray<PanelId>,
  defaultValue?: ReadonlyArray<PanelId>
): [ReadonlyArray<PanelId>, (next: ReadonlyArray<PanelId>) => void] {
  const [internalValue, setInternalValue] = useState<ReadonlyArray<PanelId>>(() =>
    normalizePanelIds(controlledValue ?? defaultValue)
  );
  const isControlled = controlledValue !== undefined;
  const resolvedValue = isControlled ? normalizePanelIds(controlledValue) : internalValue;

  useEffect(() => {
    if (!isControlled) {
      return;
    }
    setInternalValue(normalizePanelIds(controlledValue));
  }, [isControlled, controlledValue]);

  const setValue = useCallback(
    (next: ReadonlyArray<PanelId>) => {
      if (!isControlled) {
        setInternalValue(normalizePanelIds(next));
      }
    },
    [isControlled]
  );

  return [resolvedValue, setValue];
}
