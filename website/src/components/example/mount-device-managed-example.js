/**
 * Mount an imperative example and optionally let the website own its rendering device.
 */
export async function mountDeviceManagedExample(container, mount, mountProps = {}, options = {}) {
  const {deviceTabs = false, mountLabel = 'example'} = options;

  if (!deviceTabs) {
    return await mount(container, mountProps);
  }

  const {DeviceManagerController, DeviceTabsWidget} = await import('@deck.gl-community/widgets');
  const manager = new DeviceManagerController();
  let cleanup;
  let activeDevice;
  let currentViewState = mountProps.initialViewState;
  let disposed = false;
  let mountGeneration = 0;
  let mountQueue = Promise.resolve();
  const widgetOptions = typeof deviceTabs === 'object' ? deviceTabs : {};
  const deviceTabsWidget = new DeviceTabsWidget({
    id: `${mountLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-device-tabs`,
    devices: ['webgpu', 'webgl2'],
    placement: widgetOptions.placement ?? 'top-right',
    manager
  });

  const unsubscribe = manager.subscribe(({device}) => {
    if (!device || device === activeDevice || disposed) {
      return;
    }

    activeDevice = device;
    const generation = ++mountGeneration;
    mountQueue = mountQueue.then(async () => {
      if (disposed || generation !== mountGeneration) {
        return;
      }

      cleanup?.();
      cleanup = undefined;
      manager.reparentCanvas(container, device);

      const nextCleanup = await mount(container, {
        ...mountProps,
        device,
        initialViewState: currentViewState,
        widgets: [...(mountProps.widgets ?? []), deviceTabsWidget],
        onViewStateChange(params) {
          currentViewState = params.viewState;
          return mountProps.onViewStateChange?.(params) ?? params.viewState;
        },
        onDeckInitialized(deck) {
          manager.reparentCanvas(deck.props.parent ?? container, device);
          mountProps.onDeckInitialized?.(deck);
        }
      });

      if (disposed || generation !== mountGeneration) {
        nextCleanup?.();
        return;
      }
      cleanup = nextCleanup;
    });
  });

  try {
    await manager.initialize();
    await mountQueue;

    return () => {
      disposed = true;
      mountGeneration++;
      unsubscribe();
      cleanup?.();
      manager.reset();
    };
  } catch (error) {
    disposed = true;
    mountGeneration++;
    unsubscribe();
    cleanup?.();
    manager.reset();
    throw error;
  }
}
