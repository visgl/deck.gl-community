# Introduction

<p className="badges introduction-badges">
  <a href="https://github.com/visgl/deck.gl-community/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT license" height="20" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/6.0.3-3178c6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 6.0.3" height="20" /></a>
  <a href="https://www.npmjs.com/package/@deck.gl-community/layers"><img src="https://img.shields.io/npm/v/@deck.gl-community/layers?style=flat-square&amp;color=8064a2" alt="Latest layers release" height="20" /></a>
  <a href="https://www.npmjs.com/package/@deck.gl-community/layers"><img src="https://img.shields.io/npm/dm/@deck.gl-community/layers?style=flat-square&amp;label=layers%20downloads&amp;color=8064a2" alt="Monthly downloads for the layers package" height="20" /></a>
  <a href="https://github.com/visgl/deck.gl-community"><img src="https://img.shields.io/github/stars/visgl/deck.gl-community?style=flat-square&amp;logo=github" alt="GitHub stars" height="20" /></a>
  <a href="https://github.com/visgl/deck.gl-community/graphs/contributors"><img src="https://img.shields.io/github/contributors/visgl/deck.gl-community?style=flat-square&amp;logo=github" alt="GitHub contributors" height="20" /></a>
</p>

deck.gl-community publishes add-on layers, UI components, and integrations for
[deck.gl](https://deck.gl). See the [package index](/docs/category/packages) to find an API or check
[WebGPU support](./webgpu.md) before choosing a rendering backend.

Visit [Community](./community.md) to get help or contribute and [Attribution](./references-and-credits.md)
for project credits and licensing.

:::caution
The deck.gl-community repo collects unofficial deck.gl modules that sometimes do not have dedicated maintainers, and can also host new tentative deck.gl modules during the incubation stage. Official vis.gl / Open Visualization maintainer support is not guaranteed. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::

## Scope

This repository is intended to host modules that complement the various modules already provided by the core deck.gl framework. 
While any module that is properly scoped and of sufficient value to the community could be a candidate for this repository, 
common modules type are:

- additional **layer packs** (beyond the various layer packs available in deck.gl)
- additional **base map** integrations (beyond the integrations supported by deck.gl)
- additional **React bindings** (beyond the `@deck.gl/react` module).

## Goals

Some practical goals for this repo:
- The community modules in this repo are expected to be used with deck.gl v9.4 or later releases.
- The version of the published npm modules will follow deck.gl's major and minor version numbering, making it easy to see at a glance which deck.gl version is supported by a specific `@deck.gl-community/...` module.
- Community modules are expected to support WebGL2 rendering in deck.gl and are gradually adding WebGPU support. See the [WebGPU compatibility and migration roadmap](./webgpu.md) for layer-specific support, backend selection, and remaining porting work.

# Official Support

Community modules are not officially supported by the core deck.gl maintainers,
but the overall repository setup is expected to have at least intermittent, part-time support from one or more community members, to maintain build tooling and updates to new major deck.gl versions. Note that response times and fix times can be slow.

## Community Support

The continued inclusion of a specific module into this repository can depend on whether there is sufficient community support for the module.
This means that modules could be removed from this repository if the core deck.gl team feels that the community is no longer able to provide sufficient support.
If a module was to be removed, applications can of course copy the module's source code, but will need to maintain the code on their own.

## Contributing

Bug fixes are highly encouraged!

For feature extensions to existing modules, it is generally recommended to start a discussion before you open a PR.

If you have a new module that you think could fit into this repository, please start by opening a GitHub issue to start a discussion, or reach out in the OpenJS slack.
Note that for a new module you will also be asked to assess what level of maintenance you will be able to provide over the longer term.

## Maintainers

We are always looking for long-term or short-term maintainers. If you'd like to work on one of these modules, even if only temporarily, the Open Visualization team is ready to welcome and support you.

## Governance

Final decisions ultimately rest with the OpenJS Open Visualization TSC (Technical Steering Committee), but decisions are often made in the bi-weekly Linux Foundation / OpenJS OpenVisualization meetings which are open to everyone.
