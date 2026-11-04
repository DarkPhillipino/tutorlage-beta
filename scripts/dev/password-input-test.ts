// Guards the "eye" on every password box (CEO, 4 Nov 2026: "add the ability to view your password while typing it").
// Run: npx tsx scripts/dev/password-input-test.ts
// What it checks:
//  - nobody writes a raw password <input> any more: every password box in src/ and admin/src/ goes through PasswordInput, so no box can
//    be added later without the eye (the only `type="password"` text allowed is inside the two PasswordInput files);
//  - the rendered box starts hidden (type password), has the eye button named "Show password" (not pressed), is not a submit button, keeps the
//    id / required / autocomplete / placeholder / class the screen gave it, and leaves room on the right so text never runs under the eye;
//  - the admin app's own copy (admin/ imports nothing from src/) renders the same markup as the app's copy, so the two cannot drift;
//  - the stylesheets hide Edge's built-in eye so the box never shows two.
// The click that turns the text visible is proved in a real browser (the preview), not here: this repo has no fake browser (no jsdom).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { PasswordInput, SHOW_PASSWORD_LABEL, HIDE_PASSWORD_LABEL } from '../../src/components/PasswordInput';
import { PasswordInput as AdminPasswordInput } from '../../admin/src/components/PasswordInput';

const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const RootReact = rootRequire('react') as typeof import('react');
const renderRoot = (rootRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;
const AdminReact = adminRequire('react') as typeof import('react');
const renderAdmin = (adminRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8');

// ---- 1. No raw password boxes -------------------------------------------------------------------------------------------------------------
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}
const allowed = new Set(['src/components/PasswordInput.tsx', 'admin/src/components/PasswordInput.tsx']);
const offenders: string[] = [];
let boxes = 0;
for (const file of [...sourceFiles('src'), ...sourceFiles('admin/src')]) {
  const rel = relative('.', file).replace(/\\/g, '/');
  const text = read(file);
  if (!allowed.has(rel)) {
    // A raw box: type="password", type='password', or type={... 'password' ...}.
    if (/type\s*=\s*(["']password["']|\{[^}]*["']password["'][^}]*\})/.test(text)) offenders.push(rel);
    boxes += (text.match(/<PasswordInput\b/g) ?? []).length;
  }
}
check('no raw password box outside PasswordInput (src/ and admin/src/)', offenders.length === 0, offenders.join(', '));
check('the nine password boxes all use PasswordInput (8 in the app, 1 on the admin sign-in)', boxes === 9, `found ${boxes}`);

// ---- 2. What one box renders --------------------------------------------------------------------------------------------------------------
const box = renderRoot(
  RootReact.createElement(PasswordInput, {
    id: 'password',
    required: true,
    value: 'abc',
    onChange: () => undefined,
    autoComplete: 'new-password',
    placeholder: 'At least 8 characters',
    className: 'my-box-class',
  }),
);
check('the box starts hidden (type="password")', /<input[^>]*type="password"/.test(box), box);
check('it is never a plain-text box on first draw', !/type="text"/.test(box));
check(`the eye button is named "${SHOW_PASSWORD_LABEL}" and not pressed`, box.includes(`aria-label="${SHOW_PASSWORD_LABEL}"`) && box.includes('aria-pressed="false"'), box);
check('the eye is a type="button" (pressing it never submits the form)', /<button[^>]*type="button"/.test(box), box);
check('the screen\'s id, required, autocomplete, placeholder and class reach the input', /<input[^>]*id="password"/.test(box) && /<input[^>]*required/.test(box)
  && /<input[^>]*autoComplete="new-password"|<input[^>]*autocomplete="new-password"/i.test(box) && /<input[^>]*placeholder="At least 8 characters"/.test(box) && /<input[^>]*class="my-box-class"/.test(box), box);
check('the box leaves room on the right for the eye', /<input[^>]*style="[^"]*padding-right:3rem/.test(box), box);
check('capital letters, auto-correct and spell-check stay off (a revealed password is not ordinary text)', /autoCapitalize="none"|autocapitalize="none"/i.test(box) && /autoCorrect="off"|autocorrect="off"/i.test(box) && /spellCheck="false"|spellcheck="false"/i.test(box), box);
check('the two labels differ (so a screen reader hears the change)', (SHOW_PASSWORD_LABEL as string) !== HIDE_PASSWORD_LABEL);

// ---- 3. The admin copy matches --------------------------------------------------------------------------------------------------------------
const props = { id: 'password', required: true, value: 'abc', onChange: () => undefined, className: 'my-box-class' };
const adminBox = renderAdmin(AdminReact.createElement(AdminPasswordInput, props));
const appBox = renderRoot(RootReact.createElement(PasswordInput, props));
check('the admin app\'s copy renders exactly what the app\'s copy renders', adminBox === appBox, `${adminBox}\n${appBox}`);
// Same code too, not only same output: the two files differ only in their comment lines.
const code = (p: string) => read(p).split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n').trim();
check('the two files hold the same code (comments aside)', code('src/components/PasswordInput.tsx') === code('admin/src/components/PasswordInput.tsx'));

// ---- 4. Edge's own eye is hidden -----------------------------------------------------------------------------------------------------------
for (const css of ['src/index.css', 'admin/src/index.css']) {
  const text = read(css);
  check(`${css} hides Edge's built-in eye (::-ms-reveal)`, /input\[type="password"\]::-ms-reveal[\s\S]*display:\s*none/.test(text));
}

if (failed > 0) {
  console.log(`${failed} FAILED`);
  process.exitCode = 1;
} else {
  console.log('all ok');
}
