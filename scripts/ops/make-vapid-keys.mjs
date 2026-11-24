// Makes ONE VAPID key pair for web push (24 Nov 2026). Run: node scripts/ops/make-vapid-keys.mjs <folder-outside-every-repository>
// The PRIVATE key is written to <folder>/vapid-private-key.txt and is NEVER printed, committed or published. Only the PUBLIC key is printed (it is meant to be public:
// it goes into the database setting web_push_public_key and the browser sends it when a tutor taps "Turn on alerts"). Refuses to overwrite an existing key file,
// and refuses a folder inside a git repository.
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = process.argv[2];
if (!dir) { console.error('Give a folder outside every repository.'); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
let inRepo = true;
try { execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' }); } catch { inRepo = false; }
if (inRepo) { console.error('That folder is inside a git repository. Choose another.'); process.exit(2); }
const file = path.join(dir, 'vapid-private-key.txt');
if (fs.existsSync(file)) { console.error('A key file already exists there; not overwritten.'); process.exit(2); }
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
fs.writeFileSync(file, `${jwk.d}\n`, { mode: 0o600 });
console.log(`Private key saved to ${file} (not printed).`);
console.log(`PUBLIC key: ${pub}`);
