// Cloudflare Workers entry for the payments API (master backlog item 1; the CEO chose Cloudflare on
// 2026-10-02 and pays for Workers Paid). Config is in wrangler.jsonc at the project root.
//
// Runs the same Express app as `npm run server`: index.ts calls app.listen(PORT), and httpServerHandler
// sends each incoming request to whatever is listening on that port (8787 unless PORT is set).
// The imports run in this order, so settings are in place before index.ts reads them.
import './worker-env';
import './index';
import { httpServerHandler } from 'cloudflare:node';

export default httpServerHandler({ port: Number(process.env.PORT) || 8787 });
