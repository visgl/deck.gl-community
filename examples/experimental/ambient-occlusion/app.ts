// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, type Effect, type MapViewState} from '@deck.gl/core';
import {CORTAOEffect, type CORTAOEffectProps} from '@deck.gl-community/experimental';
import {getScene, SCENES, type Scene, type SceneId} from './scenes';

export {SCENES, type SceneId} from './scenes';

/** Options of {@link mountAmbientOcclusionExample}. */
export type AmbientOcclusionExampleOptions = {
  /** The first scene. Default: the first scene of {@link SCENES}. */
  scene?: SceneId;
  /** Start with the effect on. Default `true`. */
  ambientOcclusion?: boolean;
  /** Initial effect props. */
  effectProps?: CORTAOEffectProps;
  /** Show the settings panel. Default `true`. */
  controls?: boolean;
  /** Initial camera. Default: the camera of the scene. */
  initialViewState?: MapViewState;
  /** Called when the data of a scene is loaded and the first frame with the data is drawn. */
  onReady?: (deck: Deck<MapView>) => void;
};

/** The handle that the example returns. */
export type AmbientOcclusionExample = {
  /** The deck.gl instance. */
  deck: Deck<MapView>;
  /** The effect. It stays the same object when it is turned off and on. */
  effect: CORTAOEffect;
  /** The current scene. */
  readonly scene: SceneId;
  /** Loads a scene and moves the camera to it. */
  setScene: (scene: SceneId) => void;
  /** Turns the effect on or off. Off removes it from the effects list. */
  setAmbientOcclusion: (enabled: boolean) => void;
  /** Updates the effect props. */
  setEffectProps: (props: CORTAOEffectProps) => void;
  /** Removes the example. */
  finalize: () => void;
  /** True when the data of the current scene is loaded and drawn. */
  readonly ready: boolean;
};

/**
 * Mounts a deck.gl map with CORTAO ambient occlusion and a choice of test scenes.
 */
export function mountAmbientOcclusionExample(
  container: HTMLElement,
  options: AmbientOcclusionExampleOptions = {}
): AmbientOcclusionExample {
  const effect = new CORTAOEffect(options.effectProps);
  let scene: Scene = getScene(options.scene);
  let ambientOcclusion = options.ambientOcclusion ?? true;
  /** True while the user holds the space key, which shows the scene without the effect. */
  let isHeld = false;
  let isReady = false;
  /** Increments on each scene change, so that a late callback of an old scene does nothing. */
  let generation = 0;

  const getEffects = (): Effect[] => [
    ...(scene.lighting ? [scene.lighting] : []),
    ...(ambientOcclusion && !isHeld ? [effect] : [])
  ];
  const createLayers = () => {
    const current = ++generation;
    isReady = false;
    return scene.createLayers(() => {
      if (current === generation) {
        isReady = true;
        options.onReady?.(deck);
      }
    });
  };

  const deck: Deck<MapView> = new Deck<MapView>({
    parent: container as HTMLDivElement,
    views: new MapView({controller: true}),
    initialViewState: options.initialViewState ?? scene.viewState,
    effects: getEffects(),
    layers: []
  });
  deck.setProps({layers: createLayers()});

  const updateEffects = () => deck.setProps({effects: getEffects()});
  const setAmbientOcclusion = (enabled: boolean) => {
    ambientOcclusion = enabled;
    updateEffects();
  };
  const setEffectProps = (props: CORTAOEffectProps) => {
    effect.setProps(props);
    deck.redraw('CORTAO props changed');
  };
  const setScene = (id: SceneId) => {
    scene = getScene(id);
    deck.setProps({
      initialViewState: {...scene.viewState},
      effects: getEffects(),
      layers: createLayers()
    });
    attribution.textContent = scene.attribution;
    if (panel) {
      panel.scene.value = scene.id;
      panel.description.textContent = scene.description;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Space' && !event.repeat && !isFormControl(event.target)) {
      event.preventDefault();
      isHeld = true;
      updateEffects();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space' && isHeld) {
      isHeld = false;
      updateEffects();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const attribution = document.createElement('div');
  attribution.style.cssText =
    'position:absolute;right:0;bottom:0;z-index:1;padding:2px 6px;max-width:60%;' +
    'background:rgba(255,255,255,0.8);font:11px sans-serif';
  attribution.textContent = scene.attribution;
  container.style.position = 'relative';
  container.append(attribution);

  const panel = options.controls === false ? null : createControls(container, effect.props);
  if (panel) {
    panel.scene.value = scene.id;
    panel.description.textContent = scene.description;
    panel.scene.onchange = () => {
      setScene(panel.scene.value as SceneId);
      const url = new URL(location.href);
      url.searchParams.set('scene', panel.scene.value);
      history.replaceState(null, '', url);
    };
    panel.ambientOcclusion.checked = ambientOcclusion;
    panel.ambientOcclusion.onchange = () => setAmbientOcclusion(panel.ambientOcclusion.checked);
    panel.showOcclusion.onchange = () =>
      setEffectProps({showOcclusion: panel.showOcclusion.checked});
    panel.filter.onchange = () => setEffectProps({filter: panel.filter.checked});
    panel.sampleCount.onchange = () =>
      setEffectProps({sampleCount: Number(panel.sampleCount.value)});
    panel.radius.onchange = () => setEffectProps({radius: Number(panel.radius.value)});
    panel.screenRadius.oninput = () => {
      panel.screenRadiusValue.textContent = panel.screenRadius.value;
      setEffectProps({maxScreenSpaceRadius: Number(panel.screenRadius.value)});
    };
    panel.intensity.oninput = () => {
      panel.intensityValue.textContent = panel.intensity.value;
      setEffectProps({intensity: Number(panel.intensity.value)});
    };
  }

  return {
    deck,
    effect,
    get scene() {
      return scene.id;
    },
    setScene,
    setAmbientOcclusion,
    setEffectProps,
    finalize: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      panel?.root.remove();
      attribution.remove();
      deck.finalize();
      isReady = false;
    },
    get ready() {
      return isReady;
    }
  };
}

/** Tests whether a key event goes to a form control, where the space key has its own use. */
function isFormControl(target: EventTarget | null): boolean {
  return target instanceof HTMLSelectElement || target instanceof HTMLInputElement;
}

/** The world-space radius choices, in meters. `Infinity` leaves only the screen-space limit. */
const RADIUS_CHOICES = [Number.POSITIVE_INFINITY, 1000, 300, 100, 30, 10, 3];

/** Creates the settings panel. */
function createControls(container: HTMLElement, props: Required<CORTAOEffectProps>) {
  const root = document.createElement('div');
  root.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:1;padding:8px 12px;border-radius:6px;' +
    'background:rgba(255,255,255,0.9);font:13px sans-serif;line-height:1.8;max-width:300px';
  const sceneOptions = SCENES.map(scene => `<option value="${scene.id}">${scene.label}</option>`);
  const sampleOptions = [4, 8, 12, 16, 24, 32].map(
    count => `<option${count === props.sampleCount ? ' selected' : ''}>${count}</option>`
  );
  const radiusOptions = RADIUS_CHOICES.map(
    radius =>
      `<option value="${radius}"${radius === props.radius ? ' selected' : ''}>` +
      `${Number.isFinite(radius) ? `${radius} m` : 'No limit'}</option>`
  );
  root.innerHTML = `
    <label>Scene <select name="scene">${sceneOptions.join('')}</select></label><br>
    <div name="description" style="color:#555;line-height:1.3;margin-bottom:4px"></div>
    <label><input type="checkbox" name="ambientOcclusion"> Ambient occlusion</label><br>
    <label><input type="checkbox" name="showOcclusion"${props.showOcclusion ? ' checked' : ''}>
      Show occlusion only</label><br>
    <label><input type="checkbox" name="filter"${props.filter ? ' checked' : ''}>
      Bilateral filter</label><br>
    <label>Samples <select name="sampleCount">${sampleOptions.join('')}</select></label><br>
    <label>Radius <select name="radius">${radiusOptions.join('')}</select></label><br>
    <label>Screen radius <input type="range" name="screenRadius" min="0.02" max="0.5" step="0.01"
      value="${props.maxScreenSpaceRadius}"> <span name="screenRadiusValue">${props.maxScreenSpaceRadius}</span></label><br>
    <label>Intensity <input type="range" name="intensity" min="0.25" max="4" step="0.05"
      value="${props.intensity}"> <span name="intensityValue">${props.intensity}</span></label><br>
    <div style="color:#555">Hold <kbd>Space</kbd> to see the scene without the effect.</div>`;
  container.style.position = 'relative';
  container.append(root);
  const get = <T extends Element>(name: string) => root.querySelector(`[name="${name}"]`) as T;
  return {
    root,
    scene: get<HTMLSelectElement>('scene'),
    description: get<HTMLDivElement>('description'),
    ambientOcclusion: get<HTMLInputElement>('ambientOcclusion'),
    showOcclusion: get<HTMLInputElement>('showOcclusion'),
    filter: get<HTMLInputElement>('filter'),
    sampleCount: get<HTMLSelectElement>('sampleCount'),
    radius: get<HTMLSelectElement>('radius'),
    screenRadius: get<HTMLInputElement>('screenRadius'),
    screenRadiusValue: get<HTMLSpanElement>('screenRadiusValue'),
    intensity: get<HTMLInputElement>('intensity'),
    intensityValue: get<HTMLSpanElement>('intensityValue')
  };
}
