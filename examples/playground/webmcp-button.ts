// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type WebMcpState = 'active' | 'unavailable' | 'disabled' | 'initializing';

const STATES: Record<WebMcpState, {indicator: string; title: string; description: string}> = {
  active: {
    indicator: '✅',
    title: 'WebMCP active',
    description:
      'Browser agents can inspect and import this page’s points, use approved templates, and reset the camera. Click to disable.'
  },
  unavailable: {
    indicator: '❌',
    title: 'WebMCP not available',
    description:
      'This browser does not provide WebMCP. The JSON editor and preview remain available.'
  },
  disabled: {
    indicator: '🚫',
    title: 'WebMCP disabled',
    description:
      'Browser tools are off. Click to enable them. Imported points stay in this page when tools are disabled.'
  },
  initializing: {
    indicator: '🚧',
    title: 'WebMCP initializing',
    description: 'Registering this page’s browser tools. Please wait for the connection to finish.'
  }
};
let nextTooltipId = 0;

/** A single status toggle with a tooltip available to mouse and keyboard users. */
export function createWebMcpButton(parent: HTMLElement) {
  const document = parent.ownerDocument;
  const wrapper = document.createElement('span');
  wrapper.style.cssText = 'position:relative;display:inline-flex';
  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText =
    'display:inline-flex;align-items:center;gap:7px;border:1px solid #cbd5e1;border-radius:999px;padding:7px 12px;background:#f8fafc;color:#0f172a;font:600 12px system-ui;cursor:pointer';
  const indicator = document.createElement('span');
  indicator.setAttribute('aria-hidden', 'true');
  button.append('WebMCP', indicator);
  const tooltip = document.createElement('div');
  tooltip.id = `playground-webmcp-tooltip-${++nextTooltipId}`;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  tooltip.style.cssText =
    'position:absolute;right:0;top:calc(100% + 8px);width:260px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:12px 14px;border:1px solid #334155;border-radius:12px;background:#0f172a;color:#f8fafc;box-shadow:0 8px 24px rgba(15,23,42,0.22);font:12px/1.5 system-ui;z-index:1000;pointer-events:none';
  const title = document.createElement('strong');
  title.style.cssText = 'display:block;margin-bottom:4px;font-size:13px';
  const description = document.createElement('div');
  description.style.color = '#cbd5e1';
  tooltip.append(title, description);
  button.setAttribute('aria-describedby', tooltip.id);
  wrapper.append(button, tooltip);
  parent.append(wrapper);
  let hovered = false;
  let focused = false;
  const showTooltip = () => {
    tooltip.hidden = !(hovered || focused);
  };
  wrapper.onmouseenter = () => {
    hovered = true;
    showTooltip();
  };
  wrapper.onmouseleave = () => {
    hovered = false;
    showTooltip();
  };
  button.onfocus = () => {
    focused = true;
    showTooltip();
  };
  button.onblur = () => {
    focused = false;
    showTooltip();
  };
  button.onkeydown = event => {
    if (event.key === 'Escape') tooltip.hidden = true;
  };

  function setState(state: WebMcpState, errorDescription?: string) {
    const status = STATES[state];
    button.dataset.state = state;
    indicator.textContent = status.indicator;
    button.setAttribute('aria-label', status.title);
    button.setAttribute('aria-pressed', String(state === 'active'));
    button.setAttribute('aria-busy', String(state === 'initializing'));
    button.setAttribute(
      'aria-disabled',
      String(state === 'initializing' || (state === 'unavailable' && !errorDescription))
    );
    title.textContent = status.title;
    description.textContent = errorDescription ?? status.description;
    button.style.cursor = button.getAttribute('aria-disabled') === 'true' ? 'default' : 'pointer';
  }
  setState('disabled');
  return {button, setState};
}
