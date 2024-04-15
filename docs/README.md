# Introduction

This repository contains a collection of community supported modules for [deck.gl](https://deck.gl), that are intended to complement the various modules already provided by the core deck.gl framework. While any module that is properly scoped and of sufficient value to the community could be a candidate for this repository, common modules type are:

- additional **layer packs** (beyond the various layer packs available in deck.gl)
- additional **base map** integrations (beyond the integrations supported by deck.gl)
- additional **react** bindings (beyond the `@deck.gl/react` module).

## Support

Community modules are not officially supported by the core deck.gl maintainers, but have at least some intermittent, part-time support from one or more community members.

Note that the continued inclusion of each module into this repository depends to a large extent on whether there is sufficient community support for the module. Modules can be removed from this repository if the core deck.gl team feels that the community is no longer able to provide sufficient support.

If a module was to be removed, applications can of course copy the module's source code, but will need to maintain the code on their own.

## Contributing

If you have a module that you think could fit into this repository, please start by opening a GitHub issue to start a discussion, or reach out in the OpenJS slack.

## Upstreaming

On rare occasions, a new component or module may be "upstreamed" into the core deck.gl repository. 

There is a high bar when adding new code to the main deck.gl repository. The deck.gl-community repository is sometimes used to prepare (incubate) new software components so that they are ready to be added to deck.gl. 

Therefore when proposing the addition of a new component (such as a new deck.gl layer),
to the core deck.gl maintainers, it is helpful to be able to prepare the component in a monorepo environment that is similar to the deck.gl repo, complete with tests, documentation and examples. This can avoid a length and frustrating review process in the deck.gl repo.

To set expectations, most components in this repository will never be added to the main deck.gl repository.
