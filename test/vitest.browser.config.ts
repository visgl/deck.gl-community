// vitest.browser.config.ts
import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    // you may optionally give name here; Vitest uses project name by file name if omitted
    environment: 'jsdom',
    include: ['modules/**/*.browser.{test,spec}.{js,ts,jsx,tsx}'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{browser: 'chromium'}]
    }
  }
});
