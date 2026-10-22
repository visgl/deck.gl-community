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
 * unless a consumer retains it (see {@link GlyphStore.retain}).
 */
export const MAX_GLYPH_STACKS = 64;

/** Bound on the font stacks one consumer, such as a label layer, can retain. */
export const MAX_RETAINED_GLYPH_STACKS = 2 * MAX_GLYPH_STACKS;

/**
 * Bound on the font stacks all the consumers of a store can retain together: the store never
 * holds more than these, or {@link MAX_GLYPH_STACKS} when more.
 */
export const MAX_STORE_RETAINED_GLYPH_STACKS = 4 * MAX_GLYPH_STACKS;

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
let lastStoreId = 0;

export class GlyphStore {
  /**
   * Names this store among others, as of a style loaded again: a new store for the same URL holds
   * none of the glyphs this one loaded.
   */
  readonly id = ++lastStoreId;
  readonly url: string;
  private readonly fetch: typeof fetch;
  private readonly fetchOptions?: RequestInit;
  private readonly stacks = new Map<string, StackEntry>();
  /** The font stacks each consumer retains (see `retain`). */
  private readonly retained = new Map<object, Set<string>>();
  /** The number of consumers that retain each font stack retained. */
  private readonly retainCounts = new Map<string, number>();
  /** Called once when a consumer next gives back a font stack (see `onRetainedFreed`). */
  private readonly freedListeners = new Map<object, () => void>();

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
   * Keeps the glyphs of `fontStack` for `owner` until it gives the stack back (see `retainOnly`
   * and `release`). A label layer retains the font stack of each label it draws or waits for
   * before it loads any, so that loading some of them does not drop the others: a batch of
   * labels in more than {@link MAX_GLYPH_STACKS} font stacks could otherwise never load.
   *
   * Returns false when the stack cannot be retained: `owner` retains
   * {@link MAX_RETAINED_GLYPH_STACKS} stacks already, or the store's consumers
   * {@link MAX_STORE_RETAINED_GLYPH_STACKS}. Font stacks come from untrusted tile data, so
   * those bounds hold whatever a tile names; a label layer leaves the labels of a font stack it
   * cannot retain undrawn, as those of a glyph range that fails to load.
   */
  retain(owner: object, fontStack: string): boolean {
    let owned = this.retained.get(owner);
    if (owned?.has(fontStack)) {
      return true;
    }
    const count = this.retainCounts.get(fontStack) || 0;
    if (
      (owned?.size ?? 0) >= MAX_RETAINED_GLYPH_STACKS ||
      (!count && this.retainCounts.size >= MAX_STORE_RETAINED_GLYPH_STACKS)
    ) {
      return false;
    }
    if (!owned) {
      owned = new Set();
      this.retained.set(owner, owned);
    }
    owned.add(fontStack);
    this.retainCounts.set(fontStack, count + 1);
    return true;
  }

  /** Gives back the font stacks `owner` retains other than `fontStacks` (see `retain`). */
  retainOnly(owner: object, fontStacks: ReadonlySet<string>): void {
    const owned = this.retained.get(owner);
    if (!owned) {
      return;
    }
    let freed = false;
    for (const fontStack of owned) {
      if (!fontStacks.has(fontStack)) {
        owned.delete(fontStack);
        this.unretain(fontStack);
        freed = true;
      }
    }
    if (!owned.size) {
      this.retained.delete(owner);
    }
    this.evict();
    if (freed) {
      this.generation++;
      const listeners = [...this.freedListeners.values()];
      this.freedListeners.clear();
      for (const listener of listeners) {
        listener();
      }
    }
  }

  /** Gives back the font stacks `owner` retains (see `retain`). */
  release(owner: object): void {
    this.freedListeners.delete(owner);
    this.retainOnly(owner, new Set());
  }

  /**
   * Counts the times a consumer gave back font stacks: a `retain` refused before may succeed
   * once it has changed.
   */
  generation = 0;

  /**
   * Calls `listener` once, the next time a consumer gives back font stacks, in place of the
   * listener `owner` set before; null removes it. A label layer whose font stacks were refused
   * updates again then, to retain and load them.
   */
  onRetainedFreed(owner: object, listener: (() => void) | null): void {
    if (listener) {
      this.freedListeners.set(owner, listener);
    } else {
      this.freedListeners.delete(owner);
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
    return this.retainCounts.has(fontStack);
  }

  private unretain(fontStack: string): void {
    const count = this.retainCounts.get(fontStack)! - 1;
    if (count) {
      this.retainCounts.set(fontStack, count);
    } else {
      this.retainCounts.delete(fontStack);
    }
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
