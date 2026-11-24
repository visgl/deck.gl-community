// deck.gl-community
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) vis.gl contributors

import React from 'react';
import {useNavbarSecondaryMenu} from '@docusaurus/theme-common/internal';

export default function DocumentationMobileMenu() {
  const secondaryMenu = useNavbarSecondaryMenu();

  return (
    <>
      <nav className="docs-mobile-navigation" aria-label="Site navigation">
        <span>Docs</span>
        <button
          className="clean-btn docs-mobile-navigation__site-menu"
          type="button"
          onClick={() => secondaryMenu.hide()}>
          Site menu
        </button>
      </nav>
      {secondaryMenu.content}
    </>
  );
}
