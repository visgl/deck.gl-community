// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Log, COLOR} from '@probe.gl/log';

export const log = new Log({id: 'graph-layers'}).enable();

log.log({color: COLOR.CYAN}, 'Initialize graph-layers logger.');

function invokeLogFunction(result: unknown) {
  if (typeof result === 'function') {
    result();
  }
}

export function warn(message: string, ...args: unknown[]) {
  invokeLogFunction(log.warn(message, ...args));
}

export function error(message: string, ...args: unknown[]) {
  invokeLogFunction(log.error(message, ...args));
}
