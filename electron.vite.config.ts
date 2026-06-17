import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: 'src/main/index.ts'
      }
    }
  },
renderer: {
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html'
      }
    }
  }
});
