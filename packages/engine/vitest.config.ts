import { defineConfig } from 'vitest/config';

/** 100% on every rule folder of packages/engine (PRD 14.1). */
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
        'src/{schedule,day,pay,leave,money,fence,risk,credits,presence}/**': full,
      },
    },
  },
});
