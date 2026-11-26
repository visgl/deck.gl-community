// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, type Effect, type MapViewState} from '@deck.gl/core';
import {CORTAOEffect, type CORTAOEffectProps} from '@deck.gl-community/experimental';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {LumaAmbientOcclusionEffect} from './luma-ambient-occlusion-effect';
import {getScene, SCENES, type Scene, type SceneId} from './scenes';

export {SCENES, type SceneId} from './scenes';

/** The ambient occlusion methods of the comparison. */
export type MethodId = 'none' | 'cortao-webgl2' | 'cortao-webgpu' | 'ssao' | 'gtao';

/** One method of the comparison, with the device type that it needs. */
export type Method = {
  id: MethodId;
  label: string;
  /** The device type. `null`: the method runs on both. */
  device: 'webgl' | 'webgpu' | null;
};

/** All methods, in selector order. */
export const METHODS: readonly Method[] = [
  {id: 'none', label: 'None', device: null},
  {id: 'cortao-webgl2', label: 'CORTAO (WebGL2)', device: 'webgl'},
  {id: 'cortao-webgpu', label: 'CORTAO (WebGPU)', device: 'webgpu'},
  {id: 'ssao', label: 'SSAO (luma.gl, WebGPU)', device: 'webgpu'},
  {id: 'gtao', label: 'GTAO (luma.gl, WebGPU)', device: 'webgpu'}
];

/** Gets a method by id. Unknown ids get CORTAO on the given device type. */
export function getMethod(id: string | null | undefined, device: 'webgl' | 'webgpu'): Method {
  return (
    METHODS.find(method => method.id === id) ??
    METHODS.find(method => method.id === (device === 'webgpu' ? 'cortao-webgpu' : 'cortao-webgl2'))!
  );
}

/**
 * The world radius of each scene, in meters. All methods use the same radius, so that the
 * comparison is fair. CORTAO and SSAO also clamp it to `maxScreenSpaceRadius` of the screen height.
 */
export const SCENE_RADIUS: Record<SceneId, number> = {
  city: 50,
  terrain: 1000,
  primitives: 10,
  'bike-parking': 300
};

/** The effect props that the panel and the URL set. The luma.gl effect reads only some of them. */
export type ExampleEffectProps = CORTAOEffectProps;

/** Options of {@link mountAmbientOcclusionExample}. */
export type AmbientOcclusionExampleOptions = {
  /** The first scene. Default: the first scene of {@link SCENES}. */
  scene?: SceneId;
  /** The ambient occlusion method. Default: CORTAO on the device type. */
  method?: MethodId;
  /** Start with the effect on. Default `true`. */
  ambientOcclusion?: boolean;
  /** Initial effect props. `radius` defaults to {@link SCENE_RADIUS}. */
  effectProps?: ExampleEffectProps;
  /** Show the settings panel. Default `true`. */
  controls?: boolean;
  /** Initial camera. Default: the camera of the scene. */
  initialViewState?: MapViewState;
  /** The luma.gl device. Default: deck.gl creates a WebGL 2 device. */
  device?: Device;
  /** Called when the data of a scene is loaded and the first frame with the data is drawn. */
  onReady?: (deck: Deck<MapView>) => void;
  /** Called when the user moves the camera. */
  onViewStateChange?: (viewState: MapViewState) => void;
  /** Called when the user selects a scene in the panel. */
  onSceneChange?: (scene: SceneId) => void;
  /** Called when the user changes an effect prop in the panel. */
  onEffectPropsChange?: (props: ExampleEffectProps) => void;
  /** Called when the user selects another method or device. The page reloads with these values. */
  onMethodChange?: (method: MethodId, device: 'webgl' | 'webgpu') => void;
};

/** The handle that the example returns. */
export type AmbientOcclusionExample = {
  /** The deck.gl instance. */
  deck: Deck<MapView>;
  /** The effect of the method, or `null` for "None". It stays the same object when it is toggled. */
  effect: CORTAOEffect | LumaAmbientOcclusionEffect | null;
  /** The method. */
  readonly method: Method;
  /** The current scene. */
  readonly scene: SceneId;
  /** Loads a scene and moves the camera to it. */
  setScene: (scene: SceneId) => void;
  /** Turns the effect on or off. Off removes it from the effects list. */
  setAmbientOcclusion: (enabled: boolean) => void;
  /** Updates the effect props. */
  setEffectProps: (props: ExampleEffectProps) => void;
  /** Moves the camera. */
  setViewState: (viewState: MapViewState) => void;
  /** Sets the method and backend selectors of the panel back to the running method. */
  resetControls: () => void;
  /** Removes the example. */
  finalize: () => void;
  /** True when the data of the current scene is loaded and drawn. */
  readonly ready: boolean;
};

/** Creates the effect of a method. */
function createEffect(
  method: Method,
  props: ExampleEffectProps
): CORTAOEffect | LumaAmbientOcclusionEffect | null {
  switch (method.id) {
    case 'none':
      return null;
    case 'cortao-webgl2':
    case 'cortao-webgpu':
      return new CORTAOEffect(props);
    case 'ssao':
    case 'gtao':
      return new LumaAmbientOcclusionEffect({method: method.id, ...getLumaProps(props)});
  }
}

/** Gets the props that the luma.gl effect reads. */
function getLumaProps(props: ExampleEffectProps) {
  return {
    ...(props.radius !== undefined && Number.isFinite(props.radius) ? {radius: props.radius} : {}),
    ...(props.maxScreenSpaceRadius !== undefined
      ? {maxScreenSpaceRadius: props.maxScreenSpaceRadius}
      : {}),
    ...(props.showOcclusion !== undefined ? {showOcclusion: props.showOcclusion} : {})
  };
}

/**
 * Mounts a deck.gl map with screen-space ambient occlusion and a choice of test scenes and methods.
 */
export function mountAmbientOcclusionExample(
  container: HTMLElement,
  options: AmbientOcclusionExampleOptions = {}
): AmbientOcclusionExample {
  const deviceType = options.device?.type === 'webgpu' ? 'webgpu' : 'webgl';
  const method = getMethod(options.method, deviceType);
  let scene: Scene = getScene(options.scene);
  /** True when the radius comes from the scene, not from the user. */
  let isSceneRadius = options.effectProps?.radius === undefined;
  const effectProps: ExampleEffectProps = {
    radius: SCENE_RADIUS[scene.id],
    ...options.effectProps
  };
  const effect = createEffect(method, effectProps);
  let ambientOcclusion = options.ambientOcclusion ?? true;
  /** True while the user holds the space key, which shows the scene without the effect. */
  let isHeld = false;
  let isReady = false;
  /** Increments on each scene change, so that a late callback of an old scene does nothing. */
  let generation = 0;

  const getEffects = (): Effect[] => [
    ...(scene.lighting ? [scene.lighting] : []),
    ...(effect && ambientOcclusion && !isHeld ? [effect] : [])
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
    ...(options.device ? {device: options.device} : {}),
    views: new MapView({controller: true}),
    initialViewState: options.initialViewState ?? scene.viewState,
    onViewStateChange: ({viewState}) => {
      options.onViewStateChange?.(viewState as MapViewState);
      return viewState;
    },
    effects: getEffects(),
    layers: []
  });
  deck.setProps({layers: createLayers()});

  const updateEffects = () => deck.setProps({effects: getEffects()});
  const setAmbientOcclusion = (enabled: boolean) => {
    ambientOcclusion = enabled;
    updateEffects();
  };
  const setEffectProps = (props: ExampleEffectProps) => {
    Object.assign(effectProps, props);
    if (effect instanceof CORTAOEffect) {
      effect.setProps(props);
    } else if (effect) {
      effect.setProps(getLumaProps(props));
    }
    deck.redraw('ambient occlusion props changed');
  };
  const setScene = (id: SceneId) => {
    scene = getScene(id);
    if (isSceneRadius) {
      setEffectProps({radius: SCENE_RADIUS[scene.id]});
    }
    deck.setProps({
      initialViewState: {...scene.viewState},
      effects: getEffects(),
      layers: createLayers()
    });
    attribution.textContent = scene.attribution;
    if (panel) {
      panel.scene.value = scene.id;
      panel.description.textContent = scene.description;
      panel.radius.value = String(effectProps.radius);
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
    'background:rgba(255,255,255,0.8);color:#1f2328;font:11px sans-serif';
  attribution.textContent = scene.attribution;
  container.style.position = 'relative';
  container.append(attribution);

  const panel =
    options.controls === false
      ? null
      : createControls(container, method, deviceType, {
          ...(effect instanceof CORTAOEffect ? effect.props : {}),
          ...effectProps
        });
  if (panel) {
    const changeEffectProps = (props: ExampleEffectProps) => {
      setEffectProps(props);
      options.onEffectPropsChange?.(props);
    };
    panel.scene.value = scene.id;
    panel.description.textContent = scene.description;
    panel.scene.onchange = () => {
      setScene(panel.scene.value as SceneId);
      options.onSceneChange?.(scene.id);
    };
    panel.method.onchange = () => {
      const next = getMethod(panel.method.value, deviceType);
      options.onMethodChange?.(next.id, next.device ?? deviceType);
    };
    panel.device.onchange = () => {
      const nextDevice = panel.device.value as 'webgl' | 'webgpu';
      // CORTAO follows the device. The luma.gl methods need WebGPU.
      const nextMethod: MethodId = method.id.startsWith('cortao')
        ? nextDevice === 'webgpu'
          ? 'cortao-webgpu'
          : 'cortao-webgl2'
        : method.device && method.device !== nextDevice
          ? 'none'
          : method.id;
      options.onMethodChange?.(nextMethod, nextDevice);
    };
    panel.ambientOcclusion.checked = ambientOcclusion;
    panel.ambientOcclusion.onchange = () => setAmbientOcclusion(panel.ambientOcclusion.checked);
    panel.showOcclusion.onchange = () =>
      changeEffectProps({showOcclusion: panel.showOcclusion.checked});
    panel.filter.onchange = () => changeEffectProps({filter: panel.filter.checked});
    panel.sampleCount.onchange = () =>
      changeEffectProps({sampleCount: Number(panel.sampleCount.value)});
    panel.radius.onchange = () => {
      isSceneRadius = false;
      changeEffectProps({radius: Number(panel.radius.value)});
    };
    panel.screenRadius.oninput = () => {
      panel.screenRadiusValue.textContent = panel.screenRadius.value;
      changeEffectProps({maxScreenSpaceRadius: Number(panel.screenRadius.value)});
    };
    panel.intensity.oninput = () => {
      panel.intensityValue.textContent = panel.intensity.value;
      changeEffectProps({intensity: Number(panel.intensity.value)});
    };
  }

  return {
    deck,
    effect,
    method,
    get scene() {
      return scene.id;
    },
    setScene,
    setAmbientOcclusion,
    setEffectProps,
    setViewState: viewState => deck.setProps({initialViewState: {...viewState}}),
    resetControls: () => {
      if (panel) {
        panel.method.value = method.id;
        panel.device.value = deviceType;
      }
    },
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
const RADIUS_CHOICES = [Number.POSITIVE_INFINITY, 1000, 500, 300, 200, 100, 30, 10, 4, 3];

/** Creates the settings panel. */
function createControls(
  container: HTMLElement,
  method: Method,
  deviceType: 'webgl' | 'webgpu',
  props: ExampleEffectProps
) {
  const root = document.createElement('div');
  root.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:2;padding:8px 12px;border-radius:6px;' +
    'background:rgba(255,255,255,0.9);font:13px sans-serif;line-height:1.8;max-width:300px;' +
    // Set the text color, because a page with a dark theme would otherwise give light text.
    'color:#1f2328;color-scheme:light';
  const sceneOptions = SCENES.map(scene => `<option value="${scene.id}">${scene.label}</option>`);
  const methodOptions = METHODS.map(
    item =>
      `<option value="${item.id}"${item.id === method.id ? ' selected' : ''}>${item.label}</option>`
  );
  const sampleOptions = [4, 8, 12, 16, 24, 32].map(
    count => `<option${count === (props.sampleCount ?? 16) ? ' selected' : ''}>${count}</option>`
  );
  const radiusOptions = RADIUS_CHOICES.map(
    radius =>
      `<option value="${radius}"${radius === props.radius ? ' selected' : ''}>` +
      `${Number.isFinite(radius) ? `${radius} m` : 'No limit (CORTAO only)'}</option>`
  );
  const isCORTAO = method.id.startsWith('cortao');
  const cortaoOnly = isCORTAO ? '' : ' disabled title="CORTAO only"';
  const screenRadius = props.maxScreenSpaceRadius ?? 0.2;
  const intensity = props.intensity ?? 1;
  root.innerHTML = `
    <label>Method <select name="method">${methodOptions.join('')}</select></label><br>
    <label>Backend <select name="device">
      <option value="webgl"${deviceType === 'webgl' ? ' selected' : ''}>WebGL2</option>
      <option value="webgpu"${deviceType === 'webgpu' ? ' selected' : ''}>WebGPU</option>
    </select></label><br>
    <label>Scene <select name="scene">${sceneOptions.join('')}</select></label><br>
    <div name="description" style="color:#555;line-height:1.3;margin-bottom:4px"></div>
    <label><input type="checkbox" name="ambientOcclusion"> Ambient occlusion</label><br>
    <label><input type="checkbox" name="showOcclusion"${props.showOcclusion ? ' checked' : ''}>
      Show occlusion only</label><br>
    <label><input type="checkbox" name="filter"${props.filter !== false ? ' checked' : ''}${cortaoOnly}>
      Bilateral filter</label><br>
    <label>Samples <select name="sampleCount"${cortaoOnly}>${sampleOptions.join('')}</select></label><br>
    <label>Radius <select name="radius">${radiusOptions.join('')}</select></label><br>
    <label>Screen radius <input type="range" name="screenRadius" min="0.02" max="0.5" step="0.01"
      value="${screenRadius}"> <span name="screenRadiusValue">${screenRadius}</span></label><br>
    <label>Intensity <input type="range" name="intensity" min="0.25" max="4" step="0.05"
      value="${intensity}"${cortaoOnly}> <span name="intensityValue">${intensity}</span></label><br>
    <div style="color:#555">Hold <kbd>Space</kbd> to see the scene without the effect.</div>`;
  container.style.position = 'relative';
  container.append(root);
  const get = <T extends Element>(name: string) => root.querySelector(`[name="${name}"]`) as T;
  return {
    root,
    method: get<HTMLSelectElement>('method'),
    device: get<HTMLSelectElement>('device'),
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

/** Creates a device with its own canvas in a container. */
export function createExampleDevice(container: HTMLElement, type: 'webgl' | 'webgpu') {
  return luma.createDevice({
    type,
    adapters: [webgl2Adapter, webgpuAdapter],
    // Deck.gl creates its post-process buffers as rgba8unorm. On WebGPU, the layer pipelines use
    // the canvas format, so the canvas uses the same format.
    // The premultiplied alpha mode shows the page behind empty pixels, as WebGL 2 does.
    createCanvasContext: {
      container,
      useDevicePixels: false,
      colorFormat: 'rgba8unorm',
      alphaMode: 'premultiplied'
    },
    // Lets the frame timer read GPU timestamps on WebGPU. Ignored where it is not supported.
    optionalFeatures: ['timestamp-query']
  });
}

/**
 * Mounts the example with its own device, and mounts it again in place when the user selects
 * another method or backend. The scene and the effect settings stay the same. The website uses
 * this. The standalone page reloads with URL parameters instead.
 */
export async function mountSwitchableAmbientOcclusionExample(
  container: HTMLElement,
  options: Omit<AmbientOcclusionExampleOptions, 'device' | 'method' | 'onMethodChange'> = {}
): Promise<() => void> {
  let scene = options.scene;
  /** The camera of the mounted example, so a method switch keeps it. A scene change resets it. */
  let viewState = options.initialViewState;
  const effectProps: ExampleEffectProps = {...options.effectProps};
  let example: AmbientOcclusionExample | null = null;
  let device: Device | null = null;
  let deviceCanvases: Element[] = [];
  let isFinalized = false;
  /** Increments on each mount, so that a slow device request of an old mount does nothing. */
  let generation = 0;

  /** Creates a device and returns it with the canvas that luma.gl added for it. */
  const createDevice = async (type: 'webgl' | 'webgpu') => {
    const nextDevice = await createExampleDevice(container, type);
    const canvas = nextDevice.getDefaultCanvasContext().htmlCanvas;
    return {nextDevice, canvases: canvas ? [canvas] : []};
  };
  const destroyDevice = (target: Device | null, canvases: Element[]) => {
    target?.destroy();
    for (const canvas of canvases) {
      canvas.remove();
    }
  };
  const unmount = () => {
    example?.finalize();
    example = null;
    destroyDevice(device, deviceCanvases);
    device = null;
    deviceCanvases = [];
  };

  const mount = async (method?: MethodId, deviceType: 'webgl' | 'webgpu' = 'webgl') => {
    const current = ++generation;
    // Creates the new device first. If it fails, for example without WebGPU, the current
    // example keeps running.
    const {nextDevice, canvases} = await createDevice(
      getMethod(method, deviceType).device ?? deviceType
    );
    if (isFinalized || current !== generation) {
      destroyDevice(nextDevice, canvases);
      return;
    }
    unmount();
    device = nextDevice;
    deviceCanvases = canvases;
    example = mountAmbientOcclusionExample(container, {
      ...options,
      scene,
      initialViewState: viewState,
      effectProps,
      device,
      method,
      onSceneChange: nextScene => {
        scene = nextScene;
        viewState = undefined;
        options.onSceneChange?.(nextScene);
      },
      onViewStateChange: nextViewState => {
        viewState = nextViewState;
        options.onViewStateChange?.(nextViewState);
      },
      onEffectPropsChange: props => {
        Object.assign(effectProps, props);
        options.onEffectPropsChange?.(props);
      },
      onMethodChange: (nextMethod, nextDeviceType) => {
        const request = generation + 1;
        mount(nextMethod, nextDeviceType).catch(error => {
          console.error(error);
          // The running example stays. Its panel shows it again, unless a newer switch started.
          if (generation === request) {
            example?.resetControls();
          }
        });
      }
    });
  };

  await mount();
  return () => {
    isFinalized = true;
    unmount();
  };
}
