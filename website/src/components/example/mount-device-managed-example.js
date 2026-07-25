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
  let deck;
  const widgetOptions = typeof deviceTabs === 'object' ? deviceTabs : {};
  const deviceTabsWidget = new DeviceTabsWidget({
    id: `${mountLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-device-tabs`,
    devices: ['webgpu', 'webgl2'],
    placement: widgetOptions.placement ?? 'top-right',
    manager
  });

  const unsubscribe = manager.subscribe(({device}) => {
    if (deck && device && deck.device !== device) {
      deck.setProps({device});
    }
  });

  try {
    const cleanup = await mount(container, {
      ...mountProps,
      onDeckInitialized(initializedDeck) {
        deck = initializedDeck;
        manager.reparentCanvas(deck.props.parent ?? container);
        const existingWidgets = deck.props.widgets ?? [];
        if (!existingWidgets.includes(deviceTabsWidget)) {
          deck.setProps({widgets: [...existingWidgets, deviceTabsWidget]});
        }
        mountProps.onDeckInitialized?.(deck);
        void manager.initialize();
      }
    });

    return () => {
      unsubscribe();
      cleanup?.();
      deck = undefined;
      manager.reset();
    };
  } catch (error) {
    unsubscribe();
    deck = undefined;
    manager.reset();
    throw error;
  }
}
