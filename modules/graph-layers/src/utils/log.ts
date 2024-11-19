// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Log, COLOR} from 'probe.gl';

export const log = new Log({id: 'graph-layers'}).enable();

log.log({color: COLOR.CYAN}, 'Initialize graph-layers logger.')();
