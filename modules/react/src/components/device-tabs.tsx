// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {DeviceTabsWidget, type DeviceTabsWidgetProps} from '@deck.gl-community/widgets';
import {useEffect, useRef, type ComponentPropsWithoutRef} from 'react';

export type DeviceTabsProps = ComponentPropsWithoutRef<'div'> &
  Pick<DeviceTabsWidgetProps, 'devices' | 'onDeviceTypeChange'> &
  Required<Pick<DeviceTabsWidgetProps, 'manager'>>;

/** Renders the shared backend dropdown for an application-owned device manager. */
export function DeviceTabs({manager, devices, onDeviceTypeChange, ...hostProps}: DeviceTabsProps) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<DeviceTabsWidget | null>(null);

  useEffect(() => {
    return () => {
      widget.current?.onRemove();
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }

    const props = {
      manager,
      devices: devices ?? DeviceTabsWidget.defaultProps.devices,
      onDeviceTypeChange,
      autoInitialize: false
    };

    if (widget.current) {
      widget.current.setProps(props);
    } else {
      widget.current = new DeviceTabsWidget(props);
      widget.current.onRenderHTML(element);
    }
  }, [manager, devices, onDeviceTypeChange]);

  return <div {...hostProps} ref={host} />;
}
