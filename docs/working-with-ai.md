# Working with AI Coding Agents

## Find task-relevant documentation

Start at [llms.txt](https://visgl.github.io/deck.gl-community/llms.txt) for an index of
current documentation. Follow its absolute Markdown links to retrieve the relevant
package overview, API reference and developer guide. The website publishes Markdown
siblings of documentation pages, including rendered content from MDX components.
Examples and blog posts are excluded, and no combined `llms-full.txt` is generated.

## Check local versions and capabilities

Inspect the application's installed `@deck.gl-community/*` and `@deck.gl/*` versions,
package declarations and source before proposing an API. Community packages follow
deck.gl's major and minor versions. Check the package documentation for WebGPU support;
do not assume every layer supports both rendering backends.

Use the examples as runnable references and verify visual changes in a browser.
For editable layers, check the documented edit mode, GeoJSON data shape and update
callbacks before changing application state handling.

## Contribute a verified change

Read the repository and subtree `AGENTS.md` instructions and the
[contribution guide](./CONTRIBUTING.md). Use the repository's Yarn workspace, run the
relevant tests and lint changes. Include reproduction steps and verification in the
pull request. Community support is limited, so keep fixes focused and reviewable.
