import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    globals: true,
    // Colyseus test rooms hold native handles (sockets, timers) that
    // don't survive being structured-cloned through Vitest's worker
    // pool. Forked subprocesses sidestep that entirely.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
      },
    },
  },
});
