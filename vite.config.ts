import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

const externalDependencies = [
  '@modelcontextprotocol/sdk',
  'axios',
  'fs-extra',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  publicDir: false,
  build: {
    target: 'node20',
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: externalDependencies,
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
