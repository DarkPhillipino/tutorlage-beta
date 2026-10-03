// The two Cloudflare runtime modules server/worker.ts and server/worker-env.ts use, typed just enough
// for `tsc --noEmit` (the full types come with wrangler; not needed elsewhere in this project).
declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): unknown;
}

declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
