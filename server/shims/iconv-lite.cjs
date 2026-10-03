// Stand-in for the iconv-lite package, used ONLY in the Cloudflare Worker build (wrangler.jsonc "alias").
//
// Express 4 loads body-parser, and with it raw-body and iconv-lite, as soon as Express itself loads. The
// real iconv-lite 0.4.24 crashes at that moment on Workers: its package.json tells the bundler to drop
// ./lib/streams for browser-style builds, but Workers' Node compatibility does provide `stream`, so it then
// calls the dropped file ("require_streams(...) is not a function") and the Worker can't start.
// server/index.ts reads JSON bodies itself and never uses body-parser, so nothing calls into this at run
// time. It still handles UTF-8 correctly and refuses any other encoding, in case something ever does.
'use strict';

const isUtf8 = (encoding) => /^utf-?8$/i.test(String(encoding || '').trim());

function refuse(encoding) {
  throw new Error(`Encoding not supported on this server: ${encoding}`);
}

module.exports = {
  encodingExists: (encoding) => isUtf8(encoding),
  getDecoder(encoding) {
    if (!isUtf8(encoding)) refuse(encoding);
    const decoder = new TextDecoder('utf-8');
    return {
      write: (chunk) => decoder.decode(chunk, { stream: true }),
      end: () => decoder.decode(),
    };
  },
  decode(buffer, encoding) {
    if (!isUtf8(encoding)) refuse(encoding);
    return new TextDecoder('utf-8').decode(buffer);
  },
  encode(text, encoding) {
    if (!isUtf8(encoding)) refuse(encoding);
    return Buffer.from(String(text), 'utf8');
  },
};
