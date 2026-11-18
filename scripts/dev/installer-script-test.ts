// The admin installer script (SHOULD item 35, 18 Nov 2026): the fresh-folder naming and what the script is and is not allowed to do. It builds nothing here.
import { readFileSync } from 'node:fs';
import { freshFolderName, MONTHS } from '../../admin/desktop/build-installer.mjs';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const src = readFileSync('admin/desktop/build-installer.mjs', 'utf8').replace(/\r\n/g, '\n');
const d = new Date(2026, 10, 18);
check('twelve month names', MONTHS.length === 12 && MONTHS[10] === 'nov');
check('the first build of a day is build-18nov', freshFolderName(d, []) === 'build-18nov');
check('the second is -b, the third -c: the first that is free', freshFolderName(d, ['build-18nov']) === 'build-18nov-b' && freshFolderName(d, ['build-18nov', 'build-18nov-b']) === 'build-18nov-c');
check('other days and the running app\'s win-unpacked folder do not matter', freshFolderName(d, ['build-17nov', 'win-unpacked', 'build-5nov']) === 'build-18nov');
check('it refuses after build-18nov-z rather than overwrite one', (() => { try { freshFolderName(d, ['build-18nov', ...'bcdefghijklmnopqrstuvwxyz'.split('').map((c) => `build-18nov-${c}`)]); return false; } catch { return true; } })());
check('it never packs into win-unpacked or the plain installer folder (the output is always a fresh build-<date> folder)', src.includes('--config.directories.output=installer/${folder}') && !/directories\.output=installer\s/.test(src));
check('it copies one file to the Desktop only after keeping the old one, and compares the two hashes', src.includes('desktop-copy-') && src.includes('copied === hash') && src.includes('copyFileSync(built, target)'));
check('it publishes and uploads nothing and touches no secret', !/https?:\/\/|fetch\(|wrangler|supabase|git push|SERVICE_ROLE|\.env/i.test(src.replace(/\/\/.*$/gm, '')));
check('npm run installer is wired in the desktop package', readFileSync('admin/desktop/package.json', 'utf8').includes('"installer": "node build-installer.mjs"'));
if (failed > 0) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall ok');
