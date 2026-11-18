import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// The 375 px phone audit (backlog items 24 and 25): what one page looks like on a small phone, measured, not eyeballed.
// audit(page, label) looks at the page as it is NOW and returns a record:
//   - overflowPx:   how far the page is wider than the screen (sideways scrolling), 0 = none
//   - offenders:    visible things that stick out past the screen edge (a scroll box that is meant to scroll is not one)
//   - clipped:      text, buttons or fields cut off by a box that hides what does not fit
//   - modalCutOff:  a fixed window taller than the screen with no way to scroll it
//   - tooSmall24:   buttons, fields and stand-alone links smaller than 24 x 24 px (the WCAG 2.2 AA minimum, success criterion 2.5.8)
//   - under44:      the same under 44 px (the size phone guidelines recommend; advice, not a pass or fail)
//   - smallText:    text under 12 px
//   - smallFields:  typing fields under 16 px (an iPhone zooms the page in when one is tapped)
//   - axe:          WCAG 2.0, 2.1 and 2.2 level A and AA violations (axe-core)
// A record is written to test-results/mobile-audit/<label>.json and a picture to <label>.png.

export const PHONE = { width: 375, height: 812 };

export interface Hit {
  what: string;
  extra?: string;
}
export interface AuditRecord {
  label: string;
  url: string;
  overflowPx: number;
  offenders: Hit[];
  clipped: Hit[];
  modalCutOff: Hit[];
  tooSmall24: Hit[];
  under44: { count: number; sample: Hit[] };
  smallText: { count: number; sample: Hit[] };
  smallFields: { count: number; sample: Hit[] };
  axe: { id: string; impact: string | null | undefined; help: string; count: number; sample: string; nodes: string[] }[];
}

export const slug = (label: string): string => label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

// Runs inside the page. Everything here must be self-contained (it is serialised and sent to the browser).
function measure(vw: number) {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if ((n as HTMLElement).hasAttribute('aria-hidden') && (n as HTMLElement).getAttribute('aria-hidden') === 'true' && !(n as HTMLElement).closest('[role=dialog]')) return false;
    }
    return true;
  };
  const name = (el: Element) => {
    const e = el as HTMLElement;
    const cls = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const text = (e.innerText || e.getAttribute('aria-label') || (e as HTMLInputElement).placeholder || e.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const dims = (el: Element) => {
    const r = el.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}`;
  };
  const scrollsSideways = (el: Element) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
  const insideScroller = (el: Element) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (scrollsSideways(n)) return true;
    return false;
  };
  const all = Array.from(document.body.querySelectorAll('*')).filter((e) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'PATH', 'SVG', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON', 'DEFS', 'USE'].includes(e.tagName.toUpperCase()) || e.tagName.toLowerCase() === 'svg');
  const shown = all.filter(visible);

  // 1. things sticking out of the screen (topmost only)
  const sticking = shown.filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) return false;
    if (insideScroller(el)) return false;
    // a decorative layer that is meant to be cut (inside a box that hides overflow) is judged by the clip check below
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (['hidden', 'clip'].includes(cs.overflowX) && n.getBoundingClientRect().right <= vw + 1) return false;
    }
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && r.left >= vw) return false; // slid off to the side on purpose
    return true;
  });
  const offenders = sticking.filter((el) => !sticking.includes(el.parentElement as Element)).map((el) => ({ what: name(el), extra: `${dims(el)} at x=${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)}` }));

  // 2. text, buttons and fields cut off by a box that hides overflow
  const clipped: { what: string; extra: string }[] = [];
  for (const el of shown) {
    const cs = getComputedStyle(el);
    if (!['hidden', 'clip'].includes(cs.overflowX)) continue;
    if (cs.textOverflow === 'ellipsis') continue; // "..." is deliberate and the full text is still available to a screen reader
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    // only when something readable or tappable is what is being cut
    const cut = Array.from(el.querySelectorAll('*')).find((c) => {
      if (!visible(c)) return false;
      const r = c.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      if (r.right <= box.right + 1 && r.left >= box.left - 1) return false;
      const t = c as HTMLElement;
      return (c.children.length === 0 && (t.innerText || '').trim().length > 0) || ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG'].includes(c.tagName);
    });
    if (cut) clipped.push({ what: name(el), extra: `cuts ${name(cut)}; box ${dims(el)}, content ${el.scrollWidth}px wide` });
  }

  // 3. fixed windows taller than the screen that cannot be scrolled
  const vh = window.innerHeight;
  const modalCutOff: { what: string; extra: string }[] = [];
  for (const el of shown) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.height < 200 || r.bottom <= vh + 1) continue;
    const scrolls = [el, ...Array.from(el.querySelectorAll('*'))].some((c) => ['auto', 'scroll'].includes(getComputedStyle(c).overflowY) && c.scrollHeight > c.clientHeight + 1);
    if (!scrolls) modalCutOff.push({ what: name(el), extra: `${dims(el)} bottom at ${Math.round(r.bottom)} of ${vh}` });
  }

  // 4. tap targets
  const targets = shown.filter((el) => {
    const t = el.tagName.toLowerCase();
    if (!(t === 'button' || t === 'select' || t === 'textarea' || t === 'summary' || (t === 'a' && el.hasAttribute('href')) || (t === 'input' && (el as HTMLInputElement).type !== 'hidden') || ['button', 'link', 'checkbox', 'tab', 'radio', 'switch'].includes(el.getAttribute('role') ?? ''))) return false;
    if (t === 'a' && getComputedStyle(el).display === 'inline') return false; // a link inside a sentence is exempt in WCAG 2.5.8
    return true;
  });
  const sizeOf = (el: Element) => {
    // a tick box or radio is as big as the label around it
    const t = el as HTMLInputElement;
    const lab = (t.type === 'checkbox' || t.type === 'radio') && (t.closest('label') ?? (t.id ? document.querySelector(`label[for="${t.id}"]`) : null));
    const r = (lab || el).getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  const tooSmall24 = targets.filter((el) => { const s = sizeOf(el); return s.w < 24 || s.h < 24; }).map((el) => ({ what: name(el), extra: dims(el) }));
  const under44List = targets.filter((el) => { const s = sizeOf(el); return s.w < 44 || s.h < 44; }).map((el) => ({ what: name(el), extra: dims(el) }));

  // 5. small text
  const smallTextList: { what: string; extra: string }[] = [];
  for (const el of shown) {
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
    if (!own) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 12) smallTextList.push({ what: name(el), extra: `${px}px` });
  }

  // 6. typing fields under 16px
  const smallFieldList = shown.filter((el) => {
    const t = el.tagName.toLowerCase();
    if (t !== 'input' && t !== 'select' && t !== 'textarea') return false;
    const ty = (el as HTMLInputElement).type;
    if (['checkbox', 'radio', 'hidden', 'file', 'range', 'submit', 'button', 'color'].includes(ty)) return false;
    return parseFloat(getComputedStyle(el).fontSize) < 16;
  }).map((el) => ({ what: name(el), extra: `${getComputedStyle(el).fontSize}` }));

  return {
    overflowPx: Math.max(0, document.documentElement.scrollWidth - vw, document.body.scrollWidth - vw),
    offenders,
    clipped,
    modalCutOff,
    tooSmall24,
    under44: under44List,
    smallText: smallTextList,
    smallFields: smallFieldList,
  };
}

const dedupe = (hits: Hit[]): Hit[] => {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.what) ? false : (seen.add(h.what), true)));
};

export async function audit(page: Page, label: string, options: { axe?: boolean; picture?: boolean } = {}): Promise<AuditRecord> {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(250);
  const m = await page.evaluate(measure, PHONE.width);
  const record: AuditRecord = {
    label,
    url: page.url().replace(/^https?:\/\/[^/]+/, ''),
    overflowPx: m.overflowPx,
    offenders: dedupe(m.offenders),
    clipped: dedupe(m.clipped),
    modalCutOff: dedupe(m.modalCutOff),
    tooSmall24: dedupe(m.tooSmall24),
    under44: { count: m.under44.length, sample: dedupe(m.under44).slice(0, 12) },
    smallText: { count: m.smallText.length, sample: dedupe(m.smallText).slice(0, 8) },
    smallFields: { count: m.smallFields.length, sample: dedupe(m.smallFields).slice(0, 6) },
    axe: [],
  };
  if (options.axe !== false) {
    // With a window open (role="dialog", aria-modal) only the window is checked: the page behind it is dimmed and cannot be used, and it is checked
    // on its own in the record of the same screen without the window.
    const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    if ((await page.locator('[role=dialog][aria-modal=true]:visible, [role=dialog]:visible').count()) > 0) builder.include('[role=dialog]');
    const results = await builder.analyze();
    record.axe = results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '), nodes: v.nodes.slice(0, 40).map((n) => { const d = (n.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number; fontSize?: string }; return `${n.html.replace(/\s+/g, ' ').slice(0, 120)}${n.any[0]?.message && !d.contrastRatio ? ` -- ${n.any[0].message.slice(0, 160)}` : ''}${d.contrastRatio ? ` [${d.fgColor} on ${d.bgColor}, ${d.contrastRatio}, ${d.fontSize}]` : ''}`; }) }));
  }
  mkdirSync('test-results/mobile-audit', { recursive: true });
  writeFileSync(`test-results/mobile-audit/${slug(label)}.json`, JSON.stringify(record, null, 1));
  if (options.picture !== false) await page.screenshot({ path: `test-results/mobile-audit/${slug(label)}.png`, fullPage: true }).catch(() => undefined);
  return record;
}

// What blocks a release: sideways scrolling, things off the edge, cut-off content, targets under the WCAG minimum, any axe violation.
export function blocking(r: AuditRecord): string[] {
  const out: string[] = [];
  if (r.overflowPx > 1) out.push(`page is ${r.overflowPx}px wider than the screen`);
  for (const o of r.offenders) out.push(`sticks out: ${o.what} ${o.extra ?? ''}`);
  for (const o of r.clipped) out.push(`cut off: ${o.what} ${o.extra ?? ''}`);
  for (const o of r.modalCutOff) out.push(`window cannot scroll: ${o.what} ${o.extra ?? ''}`);
  // (targets under 24 px are listed in the record as advice: the WCAG 2.5.8 rule has spacing and in-sentence exceptions that only axe's own
  // "target-size" check applies correctly, and axe is run below)
  for (const a of r.axe) out.push(`axe ${a.id} (${a.impact}) x${a.count}: ${a.sample}`);
  return out;
}
