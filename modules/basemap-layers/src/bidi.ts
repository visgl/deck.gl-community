// deck.gl-community
// SPDX-License-Identifier: MIT AND BSD-3-Clause
// Copyright (c) vis.gl contributors
// Copyright (c) 2023, MapLibre contributors

/**
 * @license
 * Portions of this file are adapted from MapLibre GL JS v6.13.0, src/symbol/bidi.ts,
 * under this license:
 *
 * Copyright (c) 2023, MapLibre contributors
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 *     * Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright notice,
 *       this list of conditions and the following disclaimer in the documentation
 *       and/or other materials provided with the distribution.
 *     * Neither the name of MapLibre GL JS nor the names of its contributors
 *       may be used to endorse or promote products derived from this software
 *       without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Reordering of bidirectional text as MapLibre GL JS 6.13 does it without a right-to-left text
// plugin, on the same Unicode Bidirectional Algorithm implementation: the bidi-js package (MIT),
// a dependency, which holds its own Unicode data.
import bidiFactory, {type Bidi, type BidiCharTypeName} from 'bidi-js';

let bidiInstance: Bidi | null = null;

/** bidi-js, built on first use: it unpacks its Unicode data when built. */
function getBidi(): Bidi {
  bidiInstance ||= bidiFactory();
  return bidiInstance;
}

/** Characters that steer the bidirectional algorithm, which no font draws: dropped once used. */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/;

/** Character types rule L1 resets to the paragraph's direction at the end of a line. */
const NEUTRAL_AT_END_OF_LINE = new Set<BidiCharTypeName>(['WS', 'FSI', 'LRI', 'RLI', 'PDI']);

/** Character types rule L1 resets wherever they appear, with the whitespace before them. */
const ALWAYS_RESET = new Set<BidiCharTypeName>(['S', 'B']);

/** Character types that make text need reordering: right-to-left letters and overrides. */
const RIGHT_TO_LEFT = new Set<BidiCharTypeName>(['R', 'AL', 'RLE', 'RLO', 'RLI']);

/** One grapheme cluster of a line, with its embedding level. */
type Cluster = {text: string; level: number};

let graphemeSegmenter: {segment(text: string): Iterable<{segment: string}>} | null | undefined;

/**
 * Splits text into grapheme clusters, or code points where `Intl.Segmenter` is missing, so that a
 * letter and the marks written on it move together when a right-to-left run is reversed (rule L3).
 */
function toGraphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    const Segmenter = (Intl as any)?.Segmenter;
    graphemeSegmenter = Segmenter ? new Segmenter(undefined, {granularity: 'grapheme'}) : null;
  }
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), ({segment}) => segment)
    : Array.from(text);
}

/** Whether `text` has right-to-left characters, so that it needs {@link processBidirectionalText}. */
export function containsRightToLeftText(text: string): boolean {
  // Latin text, the common case, skips the lookups.
  if (!/[^\u0000-ɏ]/.test(text)) {
    return false;
  }
  const bidi = getBidi();
  for (const character of text) {
    if (RIGHT_TO_LEFT.has(bidi.getBidiCharTypeName(character))) {
      return true;
    }
  }
  return false;
}

/** Rule L1: whitespace at the end of a line, and separators, take the paragraph's direction. */
function resetTrailingNeutrals(clusters: Cluster[], paragraphLevel: number): void {
  const bidi = getBidi();
  let trailing = true;
  for (let i = clusters.length - 1; i >= 0; i--) {
    const type = bidi.getBidiCharTypeName(clusters[i].text[0]);
    if (ALWAYS_RESET.has(type)) {
      clusters[i].level = paragraphLevel;
      trailing = true;
    } else if (trailing && NEUTRAL_AT_END_OF_LINE.has(type)) {
      clusters[i].level = paragraphLevel;
    } else {
      trailing = false;
    }
  }
}

/**
 * Rule L2: from the deepest level down to the shallowest odd one, reverses every run at that level
 * or deeper.
 */
function reorder(clusters: Cluster[], paragraphLevel: number): Cluster[] {
  let highest = paragraphLevel;
  let lowestOdd = Infinity;
  for (const {level} of clusters) {
    if (level > highest) highest = level;
    if ((level | 1) < lowestOdd) lowestOdd = level | 1;
  }
  const ordered = clusters.slice();
  for (let level = highest; level >= lowestOdd; level--) {
    for (let start = 0; start < ordered.length; start++) {
      if (ordered[start].level < level) continue;
      let end = start;
      while (end + 1 < ordered.length && ordered[end + 1].level >= level) end++;
      for (let i = start, j = end; i < j; i++, j--) {
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
      start = end;
    }
  }
  return ordered;
}

/** Puts the code units `[start, end)` of `text` into visual order, dropping bidi controls. */
function reorderLine(
  text: string,
  levels: Uint8Array,
  paragraphLevel: number,
  start: number,
  end: number
): string {
  const bidi = getBidi();
  const clusters: Cluster[] = [];
  let index = start;
  for (const cluster of toGraphemes(text.slice(start, end))) {
    clusters.push({text: cluster, level: levels[index]});
    index += cluster.length;
  }
  resetTrailingNeutrals(clusters, paragraphLevel);
  let reordered = '';
  for (const cluster of reorder(clusters, paragraphLevel)) {
    if (BIDI_CONTROLS.test(cluster.text)) continue;
    // A bracket read right to left is drawn as its mirror image.
    reordered +=
      cluster.level % 2 ? (bidi.getMirroredCharacter(cluster.text) ?? cluster.text) : cluster.text;
  }
  return reordered;
}

/**
 * Puts text into the order it is drawn, broken into lines, as MapLibre GL JS does: the embedding
 * levels are found for the whole label, then each line is reordered on its own. A label is broken
 * at `lineBreakPoints` (UTF-16 code unit offsets) and wherever a paragraph ends.
 */
export function processBidirectionalText(text: string, lineBreakPoints: number[]): string[] {
  const {levels, paragraphs} = getBidi().getEmbeddingLevels(text);
  const inside = lineBreakPoints
    .concat(paragraphs.map(paragraph => paragraph.start))
    .filter(point => point > 0 && point < text.length);
  const bounds = [...new Set([0, ...inside, text.length])].sort((a, b) => a - b);
  const lines: string[] = [];
  // The bounds and the paragraphs are both in text order, so one pass finds each line's paragraph
  // (tile text is untrusted: a label of many short lines must not cost lines times paragraphs).
  let paragraph = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const start = bounds[i];
    while (paragraph < paragraphs.length && paragraphs[paragraph].end < start) {
      paragraph++;
    }
    const paragraphLevel =
      paragraph < paragraphs.length && paragraphs[paragraph].start <= start
        ? paragraphs[paragraph].level
        : 0;
    lines.push(reorderLine(text, levels, paragraphLevel, start, bounds[i + 1]));
  }
  return lines;
}
