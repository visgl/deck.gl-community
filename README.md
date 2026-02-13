# deck.gl-community

This repository contains a collection of community supported modules for [deck.gl](https://deck.gl).

## Troubleshooting

### Playwright browser dependencies

In restricted or offline environments (such as Codex) the `playwright` dependency can fail during `yarn install` because it attempts to download Chromium binaries. The repository includes an `.npmrc` file that sets `playwright_skip_browser_download=true` so installs can proceed without fetching browsers.

When you regain network access, install the Chromium browser binary manually before running the browser or headless Vitest projects:

```bash
npx playwright install --with-deps chromium
```

This is the same command invoked in CI and ensures the Playwright-powered tests have the required runtime.
