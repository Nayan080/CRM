import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required because esbuild (Vitest's default) does not emit decorator metadata,
// which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    env: { LOG_LEVEL: 'silent' },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          setupFiles: ['test/setup-env.ts'],
          testTimeout: 20_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
