// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Spec} from 'vega';
import {createVegaView} from '../../create-vega-view';
import spec from '../spec.json';

/** One declarative signal moves stable record slots between geographic places and stacked bars. */
export function mountMapToStacksExample(container: HTMLElement): () => void {
  container.style.height = '468px';
  const example = createVegaView(container, spec as unknown as Spec);
  let active = true;
  example.ready.catch(error => {
    if (!active) return;
    const output = container.ownerDocument.createElement('p');
    output.setAttribute('role', 'alert');
    output.textContent = String(error);
    container.append(output);
  });
  return () => {
    if (!active) return;
    active = false;
    example.finalize();
    container.replaceChildren();
  };
}
