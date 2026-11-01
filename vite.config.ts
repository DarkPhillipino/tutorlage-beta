import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Release gate SEC-HEADERS-01. GitHub Pages cannot send response headers, so the Content-Security-Policy goes in a <meta> tag, added to
// the built pages only (the development server needs inline scripts and websockets that this policy forbids). The addresses the page may
// talk to are read from the same VITE_ settings the code uses, so a build for the dev database allows the dev database and a build for
// production allows production, and nothing else.
//  - scripts: only our own files (index.html keeps no inline script);
//  - styles: our own file plus inline style attributes (React and the animation library set them);
//  - connect: our own origin, the database (https + the realtime websocket) and the payments/rooms API;
//  - images: https pictures too, because a tutor's photo can come from a sign-in provider; no fonts or frames from elsewhere;
//  - what a <meta> policy cannot do (frame-ancestors, a report address) needs a real header: see the programmer's report.
function contentSecurityPolicy(mode: string): Plugin {
  return {
    name: 'tutorlage-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const origin = (value?: string) => {
        try {
          return value ? new URL(value).origin : '';
        } catch {
          return '';
        }
      };
      const supabase = origin(env.VITE_SUPABASE_URL);
      const api = origin(env.VITE_API_BASE_URL);
      const connect = ["'self'", supabase, supabase && supabase.replace(/^https:/, 'wss:'), api].filter(Boolean).join(' ');
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        `connect-src ${connect}`,
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // Not "upgrade-insecure-requests": every address above is https already, the host redirects http to https once "Enforce
        // HTTPS" is ticked, and WebKit (Safari, every iPhone browser) applies it to a local http test server too, which stops the app.
      ].join('; ');
      return html.replace('<!--content-security-policy-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig(({mode}) => {
  return {
    // The site is served from the domain root (tutorlage.com). Only set GITHUB_PAGES to build for the old
    // github.io project address, which serves it from /tutorlage-beta/.
    base: process.env.GITHUB_PAGES ? '/tutorlage-beta/' : '/',
    plugins: [react(), tailwindcss(), contentSecurityPolicy(mode)],
    build: {
      rollupOptions: {
        output: {
          // Three long-lived vendor files instead of one big one: after a republish a returning visitor on mobile data only
          // downloads our own changed code, the React and database libraries stay in the browser's cache (PERF-BUNDLE-01).
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'vendor-react';
            if (/node_modules[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Forwards to the local Express payments API (server/index.ts) so the
      // browser only ever talks to Vite's own origin — no CORS needed.
      proxy: {
        '/api': {
          target: `http://localhost:${process.env.PORT || 8787}`,
          changeOrigin: true,
        },
      },
    },
  };
});
