// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {mountTreeFilm} from './film';
const container = document.querySelector<HTMLDivElement>('#app')!;
void mountTreeFilm(container).catch(error => {
  const progress = document.createElement('p');
  progress.id = 'progress';
  progress.setAttribute('role', 'alert');
  progress.textContent = error instanceof Error ? error.message : String(error);
  container.replaceChildren(progress);
});
