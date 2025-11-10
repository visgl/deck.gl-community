# Introduction

This repository contains a collection of "community supported" modules for [deck.gl](https://deck.gl).
deck.gl-community was originally created to provide a home for a number of excellent deck.gl add-on modules that no longer have active maintainers, with the hope that it would allow the community to keep using these add-ons, and that community contributions would help keep them alive.

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
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
- The community modules in this repo are expected to be used with deck.gl v9.0 or later releases. 
- The version of the published npm modules will follow deck.gl's major and minor version numbering, making it easy to see at a glance which deck.gl version is supported by a specific `@deck.gl-community/...` module.
- Community modules are expected to support WebGL2 rendering in deck.gl, and will hopefully gradually start supporting WebGPU rendering over time, see detailed documentation for each module / layer.

# Official Support

Community modules are not officially supported by the core deck.gl maintainers,
but the overall repository setup is expected to have at least intermittent, part-time support from one or more community members, to maintain build tooling and updates to new major deck.gl versions. Note that response times and fix times can be slow.

## Community Support

The continued inclusion of a specific module into this repository can depend ton whether there is sufficient community support for the module. 
This means that modules could be removed from this repository if the core deck.gl team feels that the community is no longer able to provide sufficient support.
If a module was to be removed, applications can of course copy the module's source code, but will need to maintain the code on their own.

## Contributing

Bug fixes are highly encouraged!

For feature extensions to existing modules, it is generally recommended to start a discussion before you open a PR.

If you have a new module that you think could fit into this repository, please start by opening a GitHub issue to start a discussion, or reach out in the OpenJS slack.
Note that for a new module you will also be asked to asses what level of maintenance you will be able to provide over the longer term.

## Maintainers

We are always looking for long-term or short-term maintainers. If you'd like to work on one of these modules, even if only temporarily, the Open Visualization team is ready to welcome and support you.

## Governance

Final decisions ultimately rest with the OpenJS Open Visualization TSC (Technical Steering Committee), but decisions are often made in the bi-weekly Linux Foundation / OpenJS OpenVisualization meetings which are open to anyone.
