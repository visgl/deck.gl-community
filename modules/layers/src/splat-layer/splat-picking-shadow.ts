// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

const SHADOW_PROPS = new WeakMap<object, Record<string, unknown>>();

/** LightingEffect is excluded from picking, but its global shader still needs valid samplers. */
export function getPickingShadowProps(owner: object, props: Record<string, any>) {
  if (props.shadow?.dummyShadowMap) SHADOW_PROPS.set(owner, props.shadow);
  const previous = SHADOW_PROPS.get(owner);
  return props.picking?.isActive && previous
    ? {
        ...props,
        shadow: {...previous, project: props.project, shadowEnabled: false, drawToShadowMap: false}
      }
    : props;
}
