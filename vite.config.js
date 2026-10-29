const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig({
  plugins: [react()],
  root: 'src/frontend',
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:4173' },
  },
  build: { outDir: '../../dist', emptyOutDir: true },
});
