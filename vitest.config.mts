import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.mts', 'bin/**/*.test.mts'],
    setupFiles: ['./vitest.reset.mts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.mts'],
      exclude: ['src/**/*.test.mts', 'src/**/*-fake-io.mts', 'src/**/index.mts'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
})
