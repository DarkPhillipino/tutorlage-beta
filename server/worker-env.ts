// Copies the Worker's text settings and secrets into process.env before index.ts reads them (it reads
// them once, at start-up). Cloudflare also fills process.env itself for compatibility dates from
// 2025-04-01; this keeps index.ts working if that ever doesn't happen at start-up. Values already in
// process.env win.
import { env } from 'cloudflare:workers';

for (const [key, value] of Object.entries(env)) {
  if (typeof value === 'string' && process.env[key] === undefined) {
    process.env[key] = value;
  }
}
