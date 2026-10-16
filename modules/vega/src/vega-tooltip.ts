// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Render evaluated Vega tooltip encodings as text, without interpreting HTML. */
export function getVegaTooltip(info: {
  object?: {tooltip?: unknown; isEmpty?: boolean};
}): {text: string} | null {
  const value = info.object?.tooltip;
  if (info.object?.isEmpty || value === undefined || value === null || value === false) {
    return null;
  }
  const formatValue = (entry: unknown): string =>
    typeof entry === 'object' && entry !== null ? JSON.stringify(entry) : String(entry);
  const text =
    typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value)
          .map(([key, entry]) => `${key}: ${formatValue(entry)}`)
          .join('\n')
      : formatValue(value);
  return text ? {text} : null;
}
