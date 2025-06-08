import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'coverage/',
        '**/*.config.js',
        '**/*.config.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': new URL('./public', import.meta.url).pathname
    }
  }
}); 