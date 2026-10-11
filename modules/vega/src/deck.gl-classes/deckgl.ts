// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
import {Deck, OrbitView, type DeckProps, type OrbitViewState} from '@deck.gl/core';
import {
  createOrbitControllerClass,
  type OrbitController_Class,
  type OrbitControllerClassOptions
} from './orbit-controller';

export interface InteractiveStateVegaDeckGL {
  onCube: boolean;
  onText: boolean;
  onAxisSelection: boolean;
}
export type DeckGLInternalProps = Omit<DeckProps<OrbitView[]>, 'getCursor'> & {
  container?: HTMLElement;
  getCursor?: (state: InteractiveStateVegaDeckGL) => string;
};
export interface DeckGLClassesForPresenter {
  OrbitControllerClass: typeof OrbitController_Class;
  DeckGL_Class: typeof DeckGL_Class;
}
export class DeckGL_Class extends Deck<OrbitView[]> {
  interactiveState: InteractiveStateVegaDeckGL;
  constructor(props: DeckGLInternalProps) {
    const container = props.container || document.body;
    if (window.getComputedStyle(container).position === 'static')
      container.style.position = 'relative';
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    Object.assign(canvas.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%'
    });
    const interactiveState = {onCube: false, onText: false, onAxisSelection: false};
    super({
      ...props,
      width: '100%',
      height: '100%',
      canvas,
      getCursor: () => props.getCursor?.(interactiveState) || 'grab'
    });
    this.interactiveState = interactiveState;
  }
  getCurrentViewState(): OrbitViewState | undefined {
    return (
      this.viewState &&
      ('target' in this.viewState ? (this.viewState as OrbitViewState) : this.viewState.OrbitView)
    );
  }
  finalize() {
    const canvas = this.getCanvas();
    super.finalize();
    canvas?.remove();
  }
}
export function createDeckGLClassesForPresenter(
  options: OrbitControllerClassOptions
): DeckGLClassesForPresenter {
  return {OrbitControllerClass: createOrbitControllerClass(options), DeckGL_Class};
}
