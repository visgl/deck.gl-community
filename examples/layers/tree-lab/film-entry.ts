// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {mountTreeFilm} from './film';
void mountTreeFilm(document.querySelector<HTMLDivElement>('#app')!).catch(error => {
  document.querySelector('#progress')!.textContent = error.message;
});
