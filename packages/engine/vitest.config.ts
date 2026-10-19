import { defineConfig } from 'vitest/config';

/** 100% on every rule folder (PRD 14.1). WP-5 folders gate here; fence/risk join once WP-4 confirms 100%. */
const full = { branches: 100, functions: 100, lines: 100, statements: 100 };

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/stub.ts'],
      reporter: ['text', 'text-summary', 'json-summary'],
      thresholds: {
        'src/schedule/**': full,
        'src/day/**': full,
      },
    },
  },
});
