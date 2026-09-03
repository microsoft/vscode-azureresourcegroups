import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `host` + `allowedHosts` + `strictPort` keep the dev server reachable and framable
// by the Approve UI preview webview.
export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        allowedHosts: true,
        strictPort: false,
    },
});
