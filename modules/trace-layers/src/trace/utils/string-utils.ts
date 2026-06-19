export function capitalize(value: string) {
  return value.toUpperCase();
}

export function capitalizeFirstLetter(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

export function lowerCase(value: string) {
  return value.toLowerCase();
}

export function pluralize(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  return trimmed.toLowerCase().endsWith('s') ? `${trimmed}es` : `${trimmed}s`;
}

export type TruncateMiddleOptions = {
  maxLabelLength?: number;
  ellipsisPosition?: number;
};

export function truncateMiddle(
  value: string,
  {maxLabelLength = 40, ellipsisPosition}: TruncateMiddleOptions = {}
) {
  if (value.length <= maxLabelLength) {
    return value;
  }

  if (maxLabelLength <= 1) {
    return '…';
  }

  const resolvedPosition = ellipsisPosition ?? Math.floor((maxLabelLength - 1) / 2);
  if (resolvedPosition === -1) {
    return `${value.slice(0, maxLabelLength - 1)}…`;
  }

  const startLength = Math.min(resolvedPosition, maxLabelLength - 1);
  const endLength = Math.max(0, maxLabelLength - startLength - 1);
  const start = value.slice(0, startLength);
  const end = endLength > 0 ? value.slice(-endLength) : '';

  return `${start}…${end}`;
}

export type WrapTextOptions = {
  maxLineLength?: number;
};

export function wrapText(value: string, {maxLineLength = 80}: WrapTextOptions = {}) {
  if (maxLineLength <= 0) {
    return value;
  }

  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += maxLineLength) {
    chunks.push(value.slice(index, index + maxLineLength));
  }
  return chunks.join('\n');
}
