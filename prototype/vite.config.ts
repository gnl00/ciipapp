import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),base:'./',
  server:{host:'127.0.0.1',port:5174,strictPort:true,fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]}},
  build:{target:'safari15',outDir:'dist',emptyOutDir:true,rolldownOptions:{input:{index:fileURLToPath(new URL('index.html',import.meta.url)),preview:fileURLToPath(new URL('preview.html',import.meta.url))}}},
});
