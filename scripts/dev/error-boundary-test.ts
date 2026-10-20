// Checks on the app-wide error boundary (release gate FE-ERRBOUND-01, 20 Oct 2026): a screen that throws shows a plain message with
// a way out instead of a blank white page. There is no DOM library here, so the boundary's logic and its fallback screen are tested
// directly and the wiring is checked in the source. Run: npx tsx scripts/dev/error-boundary-test.ts
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary, ErrorScreen } from '../../src/components/ErrorBoundary';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

check('a thrown error puts the boundary into its error state', JSON.stringify(ErrorBoundary.getDerivedStateFromError()) === '{"hasError":true}');

const fine = new ErrorBoundary({ children: React.createElement('p', null, 'the page') });
check('with no error it draws the page it was given', fine.state.hasError === false && renderToStaticMarkup(fine.render() as React.ReactElement) === '<p>the page</p>');

const broken = new ErrorBoundary({ children: React.createElement('p', null, 'the page'), homeHref: '/tutorlage-beta/' });
broken.state = ErrorBoundary.getDerivedStateFromError();
const html = renderToStaticMarkup(broken.render() as React.ReactElement);
check('with an error it shows the plain message, a reload button and a link to the start, not the page', /Something went wrong/.test(html) && /Reload the page/.test(html) && /href="\/tutorlage-beta\/"/.test(html) && !html.includes('the page</p>'));
check('the message is an alert for screen readers, says what to do, and promises nothing it cannot keep (no claim about payments)', /role="alert"/.test(html) && /Reload the page to try again/.test(html) && !/payment/i.test(html));
check('the fallback screen alone draws the same words', /Something went wrong/.test(renderToStaticMarkup(React.createElement(ErrorScreen, { onReload: () => undefined, homeHref: '/' }))));

let reset: unknown = null;
const crashed = new ErrorBoundary({ children: null, resetKey: '/b' });
crashed.state = { hasError: true };
crashed.setState = ((s: unknown) => { reset = s; }) as typeof crashed.setState;
crashed.componentDidUpdate({ children: null, resetKey: '/a' });
check('going to another page (the key changes) tries drawing again', JSON.stringify(reset) === '{"hasError":false}');
reset = null;
crashed.componentDidUpdate({ children: null, resetKey: '/b' });
check('the same page does not retry in a loop', reset === null);

const logged: unknown[][] = [];
const original = console.error;
console.error = (...args: unknown[]) => { logged.push(args); };
new ErrorBoundary({ children: null }).componentDidCatch(new Error('boom'), { componentStack: '\n at X' } as React.ErrorInfo);
console.error = original;
check('the crash is written to the console (the only record until an error tracker is chosen)', logged.length === 1 && String(logged[0][0]).includes('Screen crashed'));

const main = read('src/main.tsx');
const source = read('src/components/ErrorBoundary.tsx');
check('the whole app, including sign-in and the auth provider, sits inside the boundary, inside the router', /<BrowserRouter[^>]*>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<AppErrorBoundary[^>]*>\s*<AuthProvider>[\s\S]*<\/AuthProvider>\s*<\/AppErrorBoundary>\s*<\/BrowserRouter>/.test(main));
check('the boundary uses no translation, auth or Supabase (it must work when one of them is what broke)', !/i18n|useAuth|AuthContext|supabase/i.test(source.replace(/\/\/.*$/gm, '')));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
