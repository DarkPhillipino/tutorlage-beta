import { test, expect } from './fixtures';

// PERF-BUNDLE-01 / PERF-CWV-01 / SA-NETWORK-01: the first visit on a slow phone on mobile data. This is a LAB measurement in Chromium (the
// phone profile, CPU slowed 4x, "slow 4G": 1.6 Mbit/s down, 150 ms round trip, the settings PageSpeed Insights uses for mobile). It is not
// field data from real visitors: it cannot say what real users on real networks see, only that the build is light enough to have a chance.
// Budgets: first download of the page, compressed as GitHub Pages sends it: JavaScript 200 kB, everything 300 kB; and the gate's own lab
// budgets: LCP 2.5 s, CLS 0.1, total blocking time 200 ms (blocking time = the part of every task over 50 ms, as Lighthouse counts it).
// Run it ONE AT A TIME for a fair reading (the other browser checks use all the processor and push blocking time over the budget):
//   npx playwright test tests/browser/perf.spec.ts --project=chromium --project=phone-android --workers=1
const KEY_ROUTES = ['/', '/login', '/signup/tutor'];

for (const route of KEY_ROUTES) {
  test(`${route} on a slow phone: light first download, fast largest paint, no layout shift, little blocking`, async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU and network throttling use the Chrome DevTools protocol');
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    let scriptBytes = 0;
    let totalBytes = 0;
    const sizes = new Map<string, { url: string; type: string }>();
    client.on('Network.responseReceived', (e) => sizes.set(e.requestId, { url: e.response.url, type: e.type }));
    client.on('Network.loadingFinished', (e) => {
      const info = sizes.get(e.requestId);
      if (!info || !info.url.startsWith('http://127.0.0.1')) return;
      totalBytes += e.encodedDataLength;
      if (info.type === 'Script') scriptBytes += e.encodedDataLength;
    });

    await page.addInitScript(() => {
      const v = ((window as any).__vitals = { lcp: 0, cls: 0, fcp: 0, tbt: 0 });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) v.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => { for (const e of list.getEntries() as any[]) if (!e.hadRecentInput) v.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') v.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.startTime + e.duration > v.fcp) v.tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(route);
    await expect(page.locator('#root h1, #root h2').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const v = await page.evaluate(() => (window as any).__vitals as { lcp: number; cls: number; tbt: number });
    const line = `${route} on a slow phone: LCP ${Math.round(v.lcp)} ms, CLS ${v.cls.toFixed(3)}, blocking time ${Math.round(v.tbt)} ms, JavaScript ${(scriptBytes / 1024).toFixed(0)} kB, all files ${(totalBytes / 1024).toFixed(0)} kB (compressed)`;
    console.log(line);
    test.info().annotations.push({ type: 'measured', description: line });
    expect(scriptBytes / 1024, 'JavaScript downloaded for the first screen (kB, compressed)').toBeLessThanOrEqual(200);
    expect(totalBytes / 1024, 'everything downloaded for the first screen (kB, compressed)').toBeLessThanOrEqual(300);
    expect(v.lcp, 'largest contentful paint (ms)').toBeLessThanOrEqual(2500);
    expect(v.cls, 'cumulative layout shift').toBeLessThanOrEqual(0.1);
    expect(v.tbt, 'total blocking time (ms)').toBeLessThanOrEqual(200);
  });
}
