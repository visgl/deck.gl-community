// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PANEL_THEME_SLEEK_DARK} from '@deck.gl-community/panels';

/** Shared panel chrome for standalone examples and their website embeds. */
export const EXAMPLE_PANEL_STYLE = {
  ...PANEL_THEME_SLEEK_DARK,
  color: 'var(--menu-text)',
  pointerEvents: 'auto'
} satisfies Partial<CSSStyleDeclaration>;
