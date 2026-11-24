// deck.gl-community
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) vis.gl contributors

import React from 'react';
import {useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useNavbarSecondaryMenu} from '@docusaurus/theme-common/internal';

export default function DocumentationMobileMenu() {
  const secondaryMenu = useNavbarSecondaryMenu();
  const {pathname} = useLocation();
  const examplesPath = useBaseUrl('/examples');
  const section =
    pathname === examplesPath || pathname.startsWith(`${examplesPath}/`) ? 'Examples' : 'Docs';

  return (
    <>
      <nav className="docs-mobile-navigation" aria-label="Site navigation">
        <span>{section}</span>
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
