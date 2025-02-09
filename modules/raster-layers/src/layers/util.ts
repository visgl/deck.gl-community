// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import {ShaderModule} from '../shadermodules/types';

/**
 * Test if two lists of modules are equal
 *
 * @param modules     Modules list
 * @param oldModules  Modules list
 *
 * @return true if both lists are equal
 */
export function modulesEqual(modules: ShaderModule[], oldModules: ShaderModule[]): boolean {
  if (modules.length !== oldModules.length) {
    return false;
  }

  for (let i = 0; i < modules.length; i++) {
    if (modules[i].name !== oldModules[i].name) {
      return false;
    }
  }

  return true;
}
