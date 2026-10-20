// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GLYPH_RANGE_SIZE, parseGlyphRange} from './glyph-pbf';
import type {Glyph} from './glyph-pbf';

/** Options for a {@link GlyphStore}. */
export type GlyphStoreOptions = {
  /** The style's `glyphs` URL, with `{fontstack}` and `{range}`. */
  url: string;
  /** Base URL that a relative `glyphs` URL resolves against, normally the style URL. */
  baseUrl?: string;
  fetch?: typeof fetch;
  fetchOptions?: RequestInit;
};

/** The highest code point of a glyph range, as in MapLibre GL JS. */
const MAX_CODE_POINT = 0xffff;

/**
 * Bound on the font stacks a store keeps glyphs for: stacks come from untrusted style and tile
 * data. When full, the stack used least recently is dropped, and loaded again if asked for,
 * unless a consumer retains it (see {@link GlyphStore.retain}): the store then holds more, until
 * they are released.
 */
export const MAX_GLYPH_STACKS = 64;

/**
 * Whether MapLibre GL JS draws a character with the browser's fonts rather than the style's
 * glyphs: CJK ideographs, hangul, hiragana and katakana, by default (`localIdeographFontFamily`).
 */
export function isLocalGlyph(codePoint: number): boolean {
  return /\p{Ideo}|\p{sc=Hang}|\p{sc=Hira}|\p{sc=Kana}/u.test(String.fromCodePoint(codePoint));
}

/** The glyphs of one font stack: each loaded range, by its index, as a map from code point. */
type StackEntry = {
  ranges: Map<number, Map<number, Glyph>>;
  requests: Map<number, Promise<void>>;
};

/**
 * The glyph ranges of a style's `glyphs` URL, loaded per font stack and range as labels need
 * them, as MapLibre GL JS loads them. A range that fails to load holds no glyphs, so its
 * characters are not drawn, as in MapLibre.
 */
export class GlyphStore {
  readonly url: string;
  private readonly fetch: typeof fetch;
  private readonly fetchOptions?: RequestInit;
  private readonly stacks = new Map<string, StackEntry>();
  /** The font stacks each consumer retains (see `retain`). */
  private readonly retained = new Map<object, ReadonlySet<string>>();

  constructor({url, baseUrl, fetch: fetchFn, fetchOptions}: GlyphStoreOptions) {
    this.url = resolveGlyphsUrl(url, baseUrl);
    this.fetch = fetchFn || ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.fetchOptions = fetchOptions;
  }

  /**
   * The glyph of a code point: `undefined` while its range is not loaded, `null` when the range
   * has no glyph for it.
   */
  getGlyph(fontStack: string, codePoint: number): Glyph | null | undefined {
    const range = this.getStack(fontStack, false)?.ranges.get(getGlyphRange(codePoint));
    return range ? (range.get(codePoint) ?? null) : undefined;
  }

  /** Whether the ranges of every code point of `text` are loaded, except local glyphs. */
  hasGlyphs(fontStack: string, text: string): boolean {
    const stack = this.getStack(fontStack, false);
    for (const character of text) {
      const codePoint = character.codePointAt(0)!;
      if (codePoint <= MAX_CODE_POINT && !isLocalGlyph(codePoint)) {
        if (!stack?.ranges.has(getGlyphRange(codePoint))) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Loads the ranges of the code points of `texts` that are not loaded yet. Resolves when they
   * are, or have failed; returns null when there is nothing to load.
   */
  load(fontStack: string, texts: Iterable<string>): Promise<void> | null {
    const stack = this.getStack(fontStack, true)!;
    const pending = new Set<Promise<void>>();
    for (const text of texts) {
      for (const character of text) {
        const codePoint = character.codePointAt(0)!;
        if (codePoint > MAX_CODE_POINT || isLocalGlyph(codePoint)) {
          continue;
        }
        const range = getGlyphRange(codePoint);
        if (stack.ranges.has(range)) {
          continue;
        }
        let request = stack.requests.get(range);
        if (!request) {
          request = this.loadRange(fontStack, range).then(glyphs => {
            stack.ranges.set(range, glyphs);
            stack.requests.delete(range);
          });
          stack.requests.set(range, request);
        }
        pending.add(request);
      }
    }
    return pending.size ? Promise.all(pending).then(() => {}) : null;
  }

  /**
   * Keeps the glyphs of `fontStacks` for `owner`, in place of those it retained before, until
   * it retains others or is released. A label layer retains the font stacks of the labels it
   * draws and waits for, so that loading some of them does not drop the others: a batch of
   * labels in more than {@link MAX_GLYPH_STACKS} font stacks could otherwise never load. Stacks
   * no consumer retains are dropped beyond the bound.
   */
  retain(owner: object, fontStacks: Iterable<string>): void {
    this.retained.set(owner, new Set(fontStacks));
    this.evict();
  }

  /** Gives back the font stacks `owner` retains (see `retain`). */
  release(owner: object): void {
    if (this.retained.delete(owner)) {
      this.evict();
    }
  }

  /**
   * The URL of a range: the font names of the stack, each URL-encoded, joined by commas. Font
   * stacks can come from tile data (a data-driven `text-font`), so a name cannot add path
   * segments, a query or a fragment to the URL.
   */
  getRangeUrl(fontStack: string, range: number): string {
    const begin = range * GLYPH_RANGE_SIZE;
    // `encodeURIComponent` keeps dots: a name of only dots would be a `.` or `..` path segment.
    const encoded = fontStack
      .split(',')
      .map(name => (/^\.+$/.test(name) ? name.replace(/\./g, '%2E') : encodeURIComponent(name)))
      .join(',');
    return this.url.replace(/\{(fontstack|range)\}/g, (_, name) =>
      name === 'range' ? `${begin}-${begin + GLYPH_RANGE_SIZE - 1}` : encoded
    );
  }

  private async loadRange(fontStack: string, range: number): Promise<Map<number, Glyph>> {
    const glyphs = new Map<number, Glyph>();
    try {
      const response = await this.fetch(this.getRangeUrl(fontStack, range), this.fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      for (const glyph of parseGlyphRange(await response.arrayBuffer())) {
        if (getGlyphRange(glyph.id) === range) {
          glyphs.set(glyph.id, glyph);
        }
      }
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: a missing range leaves its characters undrawn.
      console.warn(`Failed to load glyphs ${this.getRangeUrl(fontStack, range)}`, error);
    }
    return glyphs;
  }

  private getStack(fontStack: string, create: boolean): StackEntry | undefined {
    let stack = this.stacks.get(fontStack);
    if (stack) {
      // Most recently used last.
      this.stacks.delete(fontStack);
      this.stacks.set(fontStack, stack);
    } else if (create) {
      stack = {ranges: new Map(), requests: new Map()};
      this.stacks.set(fontStack, stack);
      this.evict(fontStack);
    }
    return stack;
  }

  /**
   * Drops the font stacks used least recently, beyond the bound, except those retained and
   * `keep`, which is being loaded.
   */
  private evict(keep?: string): void {
    for (const fontStack of this.stacks.keys()) {
      if (this.stacks.size <= MAX_GLYPH_STACKS) {
        return;
      }
      if (fontStack !== keep && !this.isRetained(fontStack)) {
        this.stacks.delete(fontStack);
      }
    }
  }

  private isRetained(fontStack: string): boolean {
    for (const fontStacks of this.retained.values()) {
      if (fontStacks.has(fontStack)) {
        return true;
      }
    }
    return false;
  }
}

/** The index of the range that holds a code point. */
export function getGlyphRange(codePoint: number): number {
  return Math.floor(codePoint / GLYPH_RANGE_SIZE);
}

/**
 * Resolves a relative `glyphs` URL against the style URL. The template's braces are kept, which
 * `URL` would encode.
 */
function resolveGlyphsUrl(url: string, baseUrl?: string): string {
  if (!baseUrl || /^[a-z][a-z\d+.-]*:/i.test(url)) {
    return url;
  }
  try {
    const resolved = new URL(
      url.replace(/[{}]/g, brace => (brace === '{' ? '%7B' : '%7D')),
      baseUrl
    );
    return resolved.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  } catch {
    return url;
  }
}
