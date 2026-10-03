// Builds the commit that may go to GitHub: the app's files from the current commit, without Drake/,
// CLAUDE.md or any CONTEXT.md (the CEO's rule, 2026-10-02; the repository is public), on top of
// origin/main. Saves it as the local branch `public-main` and prints what changed. It does NOT push:
// pushing is a separate step, `git push origin public-main:main`, and needs the CEO's go-ahead.
//
// Run from the working branch with everything committed:  node scripts/publish-app.mjs ["message"]
// It also installs the pre-push hook (scripts/git-hooks/pre-push) that refuses any push carrying those
// paths.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PRIVATE = /^Drake\/|^CLAUDE\.md$|(^|\/)CONTEXT\.md$/;
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();

if (git(['status', '--porcelain', '--untracked-files=no'])) {
  console.error('Commit or put aside your changes first: this publishes the current commit only.');
  process.exit(1);
}

// The hook lives in the repository's shared hooks folder, so it guards every worktree.
const hooksDir = path.resolve(git(['rev-parse', '--git-common-dir']), 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });
fs.copyFileSync(path.resolve('scripts/git-hooks/pre-push'), path.join(hooksDir, 'pre-push'));
fs.chmodSync(path.join(hooksDir, 'pre-push'), 0o755);

git(['fetch', '--quiet', 'origin', 'main']);
const head = git(['rev-parse', '--short', 'HEAD']);
const indexFile = path.join(os.tmpdir(), `tutorlage-publish-${process.pid}.index`);
const env = { ...process.env, GIT_INDEX_FILE: indexFile };
try {
  git(['read-tree', 'HEAD'], { env });
  const remove = git(['ls-files'], { env }).split('\n').filter((p) => p && PRIVATE.test(p));
  if (remove.length) {
    execFileSync('git', ['update-index', '--force-remove', '--stdin'], { env, input: remove.join('\n') + '\n' });
  }
  const tree = git(['write-tree'], { env });
  const leaked = git(['ls-tree', '-r', '--name-only', tree]).split('\n').filter((p) => PRIVATE.test(p));
  if (leaked.length) throw new Error(`Private files still in the tree: ${leaked.join(', ')}`);

  if (tree === git(['rev-parse', 'origin/main^{tree}'])) {
    console.log('Nothing to publish: GitHub main already has exactly these files.');
    process.exit(0);
  }
  const message =
    (process.argv[2] ?? `Publish app code from ${head}`) +
    `\n\nBuilt by scripts/publish-app.mjs from ${head}, without Drake/, CLAUDE.md or CONTEXT.md files.` +
    '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
  const commit = git(['commit-tree', tree, '-p', 'origin/main', '-m', message]);
  git(['update-ref', 'refs/heads/public-main', commit]);

  console.log(`public-main = ${commit.slice(0, 7)} (on top of origin/main), ${remove.length} private files left out.`);
  console.log(git(['diff', '--stat', 'origin/main', commit]));
  console.log('\nNot pushed. When the CEO says go:  git push origin public-main:main');
} finally {
  fs.rmSync(indexFile, { force: true });
}
