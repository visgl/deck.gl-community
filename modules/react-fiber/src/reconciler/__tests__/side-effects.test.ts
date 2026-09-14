import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

describe('side-effects', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original NODE_ENV
    originalEnv = process.env.NODE_ENV;

    // Setup console.warn spy
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Clear module cache to re-execute side effects
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original NODE_ENV
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv;
    }

    // Restore console.warn
    warnSpy.mockRestore();
  });

  it('should show deprecation warning in development mode', async () => {
    // Set development mode
    process.env.NODE_ENV = 'development';

    // Import side-effects to trigger the warning
    await import('../side-effects');

    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(
        '@deck.gl-community/react-fiber/reconciler/side-effects is deprecated'
      )
    );
  });

  it('should not show warning in production mode', async () => {
    // Set production mode
    process.env.NODE_ENV = 'production';

    // Import side-effects (should not trigger warning)
    await import('../side-effects');

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
