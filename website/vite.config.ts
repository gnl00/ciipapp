import {defineConfig} from 'vite';
export default defineConfig({base:process.env.VITE_BASE_PATH||'./',build:{target:'safari15',outDir:'dist'}});
