import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

// A11Y-AUTO-01: axe-core on every public page, against WCAG 2.0, 2.1 and 2.2 level A and AA (the 2.2 rules axe has). The check fails on any violation at all (not only
// "serious"/"critical"), so a regression is caught while it is small. An automated scan finds roughly a third of accessibility problems;
// it does not replace a person using a keyboard and a screen reader (the gate row says so too).
const PAGES = ['/', '/login', '/signin/tutor', '/signup/tutor', '/signup/student', '/signup/parent', '/forgot-password', '/terms', '/privacy', '/refunds', '/no/such/page'];

for (const path of PAGES) {
  test(`axe finds no WCAG A/AA violation on ${path}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'axe is run in chromium (desktop and the Android phone profile); the markup is the same in every browser');
    await page.goto(path);
    await expect(page.locator('#root h1, #root h2').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(' ')}`);
    expect(summary, `${results.passes.length} rules passed, ${results.violations.length} violated`).toEqual([]);
  });
}
