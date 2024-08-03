# Introduction

This repository contains a collection of "community supported" modules for [deck.gl](https://deck.gl).
It was created to provide a home for a number of excellent deck.gl add-on modules that no longer have active maintainers, with the hope that community contributions will keep them alive

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If you are expect timely fixes, and you are not able to contribute them yourself, do not use any deck.gl-community module.
:::

## Scope

This repository is intended to host modules that complement the various modules already provided by the core deck.gl framework. 
While any module that is properly scoped and of sufficient value to the community could be a candidate for this repository, 
common modules type are:

- additional **layer packs** (beyond the various layer packs available in deck.gl)
- additional **base map** integrations (beyond the integrations supported by deck.gl)
- additional **React bindings** (beyond the `@deck.gl/react` module).

## Goals

Overall goals for this repo is
- All modules should support deck.gl v9 on WebGL2.
- Modules will be expected to gradually start supporting deck.gl v9 on WebGPU 
- Support for deck.gl v8 is a non-goal, though one or two modules may have older versions that still work.

# Official Support

Community modules are not officially supported by the core deck.gl maintainers,
but the overall repository setup is expected to have at least intermittent, part-time support from one or more community members, to maintain build tooling etc. Note that response and fix times can be slow.

## Community Support

Note that the continued inclusion of each module into this repository depends to a large extent on whether there is sufficient community support for the module. 

Modules can be removed from this repository if the core deck.gl team feels that the community is no longer able to provide sufficient support.
If a module was to be removed, applications can of course copy the module's source code, but will need to maintain the code on their own.

## Contributing

Bug fixes are highly encouraged!

For feature extensions to existing modules, it is generally recommended to start a discussion before you open a PR.

If you have a new module that you think could fit into this repository, please start by opening a GitHub issue to start a discussion, or reach out in the OpenJS slack.
Note that for a new module you will also be asked to asses what level of maintenance you will be able to provide over the longer term.

## Governance

Final decisions ultimately rest with the OpenJS Open Visualization TSC (Technical Steering Committee), but decisions are often made in the bi-weekly Linux Foundation / OpenJS OpenVisualization meetings which are open to anyone.
