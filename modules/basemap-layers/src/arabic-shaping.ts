// deck.gl-community
// SPDX-License-Identifier: MIT AND BSD-3-Clause AND Unicode-3.0
// Copyright (c) vis.gl contributors
// Copyright (c) 2023, MapLibre contributors

/**
 * @license
 * Portions of this file are adapted from MapLibre GL JS v6.13.0, src/symbol/arabic_shaping.ts and the
 * tables its build/generate-unicode-data.ts writes to src/util/unicode_properties.g.ts,
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

/**
 * @license
 * The joining types, presentation forms and ligatures below are derived from the Unicode
 * Character Database 17.0.0 (extracted/DerivedJoiningType.txt and UnicodeData.txt), under
 * this license:
 *
 * UNICODE LICENSE V3
 *
 * COPYRIGHT AND PERMISSION NOTICE
 *
 * Copyright © 1991-2026 Unicode, Inc.
 *
 * NOTICE TO USER: Carefully read the following legal agreement. BY
 * DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
 * SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
 * TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
 * DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of data files and any associated documentation (the "Data Files") or
 * software and any associated documentation (the "Software") to deal in the
 * Data Files or Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, and/or sell
 * copies of the Data Files or Software, and to permit persons to whom the
 * Data Files or Software are furnished to do so, provided that either (a)
 * this copyright and permission notice appear with all copies of the Data
 * Files or Software, or (b) this copyright and permission notice appear in
 * associated Documentation.
 *
 * THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
 * KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
 * THIRD PARTY RIGHTS.
 *
 * IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
 * BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
 * OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
 * WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
 * ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
 * FILES OR SOFTWARE.
 *
 * Except as contained in this notice, the name of a copyright holder shall
 * not be used in advertising or otherwise to promote the sale, use or other
 * dealings in these Data Files or Software without prior written
 * authorization of the copyright holder.
 */

// Arabic shaping as MapLibre GL JS 6.13 does it, without a right-to-left text plugin.

// The joining type of each code point, as delta-encoded base-36 `start,length` ranges per type.
const ENCODED_JOINING_TYPES: Record<string, string> = {
  C: '18g,1;g2,3;4nb,1',
  D: '17k,1;5,1;1,1;1,5;4,d;1,7;1,2;z,2;8,g;i,12;1,2;9,1;1,1;1,2;14,3;2,1;28,9;3,f;2,4;1,1;2,3;2,6;7a,1;2,5;1,1;g,a;5,2;2,6;1,f',
  R: '17m,4;1,1;1,1;5,4;l,1;14,3;1,3;g,i;12,1;2,9;1,1;1,1;2,2;1,1;o,2;2x,3;f,2;4,1;1,2;3,2;6u,j;b,1;r,3;1,1;2,2;6,1',
  T: '174,b;1,1;1a,l;g,1;2t,7;2,6;2,2;1,4;bt,9;16,o;1,t;1clb,1'
};

/**
 * Each Arabic letter's Presentation Forms code points, as `[isolated, final, initial, medial]`.
 * A shape the letter is not written in is 0.
 */
const PRESENTATION_FORMS: Record<number, [number, number, number, number]> = {
  1569: [65152, 0, 0, 0],
  1570: [65153, 65154, 0, 0],
  1571: [65155, 65156, 0, 0],
  1572: [65157, 65158, 0, 0],
  1573: [65159, 65160, 0, 0],
  1574: [65161, 65162, 65163, 65164],
  1575: [65165, 65166, 0, 0],
  1576: [65167, 65168, 65169, 65170],
  1577: [65171, 65172, 0, 0],
  1578: [65173, 65174, 65175, 65176],
  1579: [65177, 65178, 65179, 65180],
  1580: [65181, 65182, 65183, 65184],
  1581: [65185, 65186, 65187, 65188],
  1582: [65189, 65190, 65191, 65192],
  1583: [65193, 65194, 0, 0],
  1584: [65195, 65196, 0, 0],
  1585: [65197, 65198, 0, 0],
  1586: [65199, 65200, 0, 0],
  1587: [65201, 65202, 65203, 65204],
  1588: [65205, 65206, 65207, 65208],
  1589: [65209, 65210, 65211, 65212],
  1590: [65213, 65214, 65215, 65216],
  1591: [65217, 65218, 65219, 65220],
  1592: [65221, 65222, 65223, 65224],
  1593: [65225, 65226, 65227, 65228],
  1594: [65229, 65230, 65231, 65232],
  1601: [65233, 65234, 65235, 65236],
  1602: [65237, 65238, 65239, 65240],
  1603: [65241, 65242, 65243, 65244],
  1604: [65245, 65246, 65247, 65248],
  1605: [65249, 65250, 65251, 65252],
  1606: [65253, 65254, 65255, 65256],
  1607: [65257, 65258, 65259, 65260],
  1608: [65261, 65262, 0, 0],
  1609: [65263, 65264, 64488, 64489],
  1610: [65265, 65266, 65267, 65268],
  1611: [65136, 0, 0, 65137],
  1612: [65138, 0, 0, 0],
  1613: [65140, 0, 0, 0],
  1614: [65142, 0, 0, 65143],
  1615: [65144, 0, 0, 65145],
  1616: [65146, 0, 0, 65147],
  1617: [65148, 0, 0, 65149],
  1618: [65150, 0, 0, 65151],
  1649: [64336, 64337, 0, 0],
  1655: [64477, 0, 0, 0],
  1657: [64358, 64359, 64360, 64361],
  1658: [64350, 64351, 64352, 64353],
  1659: [64338, 64339, 64340, 64341],
  1662: [64342, 64343, 64344, 64345],
  1663: [64354, 64355, 64356, 64357],
  1664: [64346, 64347, 64348, 64349],
  1667: [64374, 64375, 64376, 64377],
  1668: [64370, 64371, 64372, 64373],
  1670: [64378, 64379, 64380, 64381],
  1671: [64382, 64383, 64384, 64385],
  1672: [64392, 64393, 0, 0],
  1676: [64388, 64389, 0, 0],
  1677: [64386, 64387, 0, 0],
  1678: [64390, 64391, 0, 0],
  1681: [64396, 64397, 0, 0],
  1688: [64394, 64395, 0, 0],
  1700: [64362, 64363, 64364, 64365],
  1702: [64366, 64367, 64368, 64369],
  1705: [64398, 64399, 64400, 64401],
  1709: [64467, 64468, 64469, 64470],
  1711: [64402, 64403, 64404, 64405],
  1713: [64410, 64411, 64412, 64413],
  1715: [64406, 64407, 64408, 64409],
  1722: [64414, 64415, 0, 0],
  1723: [64416, 64417, 64418, 64419],
  1726: [64426, 64427, 64428, 64429],
  1728: [64420, 64421, 0, 0],
  1729: [64422, 64423, 64424, 64425],
  1733: [64480, 64481, 0, 0],
  1734: [64473, 64474, 0, 0],
  1735: [64471, 64472, 0, 0],
  1736: [64475, 64476, 0, 0],
  1737: [64482, 64483, 0, 0],
  1739: [64478, 64479, 0, 0],
  1740: [64508, 64509, 64510, 64511],
  1744: [64484, 64485, 64486, 64487],
  1746: [64430, 64431, 0, 0],
  1747: [64432, 64433, 0, 0]
};

/** The lam-alef ligatures, keyed by the pair of letters they replace, as `[isolated, final]`. */
const LIGATURES: Record<string, [number, number]> = {
  '\u0644\u0622': [65269, 65270],
  '\u0644\u0623': [65271, 65272],
  '\u0644\u0625': [65273, 65274],
  '\u0644\u0627': [65275, 65276]
};

/**
 * How a character joins to the ones beside it. `D` joins on both sides, `R` only to the character
 * before it, `L` only to the one after it, `C` joins without being written itself, `T` is skipped
 * over entirely, and `U` does not join at all.
 */
type JoiningType = 'R' | 'L' | 'D' | 'C' | 'U' | 'T';

/** Lam, the only letter written as a ligature with the letter after it. */
const LAM = 0x0644;

/**
 * The blocks Arabic is written from, and the two blocks of shapes this rewrites letters into, so
 * that text already shaped is looked at again.
 */
const ARABIC = /[؀-ۿݐ-ݿࡰ-࢟ࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** The shape a letter takes, as an index into its entry in `PRESENTATION_FORMS`. */
const ISOLATED = 0;
const FINAL = 1;
const INITIAL = 2;
const MEDIAL = 3;
type Form = typeof ISOLATED | typeof FINAL | typeof INITIAL | typeof MEDIAL;

/** One character of the text, with the shape the joining rules gave it. */
type ShapedCharacter = {
  codePoint: number;
  type: JoiningType;
  form: Form | null;
};

/** Unpacks the delta-encoded ranges of one joining type into the code points they stand for. */
function decodeRanges(encoded: string, type: JoiningType, into: Map<number, JoiningType>): void {
  let previousEnd = 0;
  for (const range of encoded.split(';')) {
    const [delta, length] = range.split(',').map(value => parseInt(value, 36));
    const start = previousEnd + delta;
    for (let codePoint = start; codePoint < start + length; codePoint++) {
      into.set(codePoint, type);
    }
    previousEnd = start + length;
  }
}

let joiningTypes: Map<number, JoiningType> | null = null;

/** The joining type of a code point; anything the Unicode database gives none stands alone. */
function joiningType(codePoint: number): JoiningType {
  if (!joiningTypes) {
    joiningTypes = new Map();
    for (const [type, encoded] of Object.entries(ENCODED_JOINING_TYPES)) {
      decodeRanges(encoded, type as JoiningType, joiningTypes);
    }
  }
  return joiningTypes.get(codePoint) ?? 'U';
}

/** Whether the character before this one reaches forward to touch it. */
function joinsForward(type: JoiningType): boolean {
  return type === 'D' || type === 'L' || type === 'C';
}

/** Whether the character after this one reaches back to touch it. */
function joinsBackward(type: JoiningType): boolean {
  return type === 'D' || type === 'R' || type === 'C';
}

/**
 * The shape a letter takes given what it can reach on either side. A letter that never joins is
 * left as it was written.
 */
function formFor(type: JoiningType, joinedBefore: boolean, joinedAfter: boolean): Form | null {
  if (type === 'D') {
    if (joinedBefore && joinedAfter) return MEDIAL;
    if (joinedBefore) return FINAL;
    if (joinedAfter) return INITIAL;
    return ISOLATED;
  }
  if (type === 'R') return joinedBefore ? FINAL : ISOLATED;
  if (type === 'L') return joinedAfter ? INITIAL : ISOLATED;
  return null;
}

/**
 * Works out the shape of every letter. Transparent characters (vowel points) are looked straight
 * through, so a letter joins to its neighbour across them.
 */
function assignLetterForms(characters: ShapedCharacter[]): void {
  const visible = characters.filter(character => character.type !== 'T');
  for (let i = 0; i < visible.length; i++) {
    const joinedBefore = i > 0 && joinsForward(visible[i - 1].type);
    const joinedAfter = i + 1 < visible.length && joinsBackward(visible[i + 1].type);
    visible[i].form = formFor(visible[i].type, joinedBefore, joinedAfter);
  }
}

/** Gives each vowel point the shape it takes over its letter: medial where the letter joins on. */
function assignMarkForms(characters: ShapedCharacter[]): void {
  let letterJoinsForward = false;
  for (const character of characters) {
    if (character.type === 'T') {
      character.form = letterJoinsForward ? MEDIAL : ISOLATED;
    } else {
      letterJoinsForward = character.form === INITIAL || character.form === MEDIAL;
    }
  }
}

/**
 * Replaces each lam followed by an alef with their ligature: final when the lam joined the letter
 * before it, isolated otherwise. Vowel points between the two follow the ligature.
 */
function applyLigatures(characters: ShapedCharacter[]): ShapedCharacter[] {
  const result: ShapedCharacter[] = [];
  for (let i = 0; i < characters.length; i++) {
    const lam = characters[i];
    if (lam.codePoint !== LAM) {
      result.push(lam);
      continue;
    }
    let next = i + 1;
    while (next < characters.length && characters[next].type === 'T') next++;
    const alef = characters[next];
    const ligature = alef && LIGATURES[String.fromCodePoint(LAM, alef.codePoint)];
    if (!ligature) {
      result.push(lam);
      continue;
    }
    const joinedBefore = lam.form === MEDIAL || lam.form === FINAL;
    result.push({codePoint: ligature[joinedBefore ? 1 : 0], type: 'R', form: ISOLATED});
    // One at a time: spreading a long run of marks from tile text would overflow the call stack.
    for (let k = i + 1; k < next; k++) {
      result.push(characters[k]);
    }
    i = next;
  }
  return result;
}

/** The presentation form of a character, or the character itself where there is none. */
function toPresentationForm(character: ShapedCharacter): number {
  if (character.form === null) return character.codePoint;
  const forms = PRESENTATION_FORMS[character.codePoint];
  if (!forms) return character.codePoint;
  return forms[character.form] || forms[ISOLATED] || character.codePoint;
}

/**
 * Rewrites Arabic letters as the shape they take in their word, named by their Arabic
 * Presentation Forms code points (U+FB50–FDFF, U+FE70–FEFF), with lam-alef ligatures, as MapLibre
 * GL JS does: glyphs are drawn one code point at a time, so the contextual shape has to be chosen
 * before glyphs are looked up. Text with no Arabic in it is returned unchanged.
 */
export function applyArabicShaping(text: string): string {
  if (!ARABIC.test(text)) {
    return text;
  }
  const characters = Array.from(text, character => {
    const codePoint = character.codePointAt(0)!;
    return {codePoint, type: joiningType(codePoint), form: null} as ShapedCharacter;
  });
  assignLetterForms(characters);
  assignMarkForms(characters);
  return applyLigatures(characters)
    .map(character => String.fromCodePoint(toPresentationForm(character)))
    .join('');
}
