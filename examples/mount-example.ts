// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Shared mount contract for standalone examples.
 */
export type ExampleMount<Props = unknown> = (
  container: HTMLElement,
  props?: Props
) => void | (() => void) | Promise<void | (() => void)>;

/**
 * Resolves the standalone example host element and applies full-page sizing defaults.
 */
export function getStandaloneExampleContainer(id = 'app'): HTMLElement {
  let container = document.getElementById(id);
  if (!(container instanceof HTMLElement)) {
    container = document.createElement('div');
    container.id = id;
    document.body.appendChild(container);
  }

  document.documentElement.style.height = '100%';
  document.body.style.margin = '0';
  document.body.style.height = '100%';
  container.style.width = '100vw';
  container.style.height = '100vh';

  return container;
}

/**
 * Runs a standalone example against the shared full-page host container.
 */
export function mountStandaloneExample<Props = unknown>(
  mount: ExampleMount<Props>,
  props?: Props
): void | (() => void) | Promise<void | (() => void)> {
  return mount(getStandaloneExampleContainer(), props);
}
