// deck.gl-community
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) vis.gl contributors

import React from 'react';
import Link from '@docusaurus/Link';
import {
  useNavbarMobileSidebar,
  useNavbarSecondaryMenu
} from '@docusaurus/theme-common/internal';

export default function DocumentationMobileMenu() {
  const mobileSidebar = useNavbarMobileSidebar();
  const secondaryMenu = useNavbarSecondaryMenu();

  return (
    <>
      <nav className="docs-mobile-navigation" aria-label="Site navigation">
        <Link
          className="docs-mobile-navigation__docs"
          to="/docs"
          onClick={() => mobileSidebar.toggle()}>
          Docs
        </Link>
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
