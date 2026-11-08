import {defineConfig} from 'vite';
export default defineConfig({
  base:'./',
  server:{host:'127.0.0.1',port:5173,strictPort:true},
  build:{target:'safari15',outDir:'dist',emptyOutDir:true},
});
