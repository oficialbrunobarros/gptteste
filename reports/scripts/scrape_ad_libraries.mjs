// Playwright scraper for Meta Ad Library / Google Ads Transparency / TikTok Creative Center
// Usage: node scrape_ad_libraries.mjs  (playwright 1.56 is globally installed at /opt/node22/lib)
// NOTE: in this sandbox the three hosts are blocked by egress policy (CONNECT 403), so this script
// was written for reproduction outside the sandbox. It was NOT able to produce results here.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const OUT = process.env.OUT || './ads_out.json';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

const META = (q, country) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(q)}&search_type=keyword_unordered&media_type=all`;
const GOOGLE = (domain, region) => `https://adstransparency.google.com/?region=${region}&domain=${domain}`;
const TIKTOK = (kw, region) =>
  `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=${region}&period=30&keyword=${encodeURIComponent(kw)}`;

const targets = [
  ...['odontocompany', 'sorridents', 'oral sim', 'odontoclinic', 'oral unic', 'amil dental', 'odontoprev',
      'invisalign', 'ideal odonto', 'odonto excellence', 'sorrifácil', 'implart', 'lente de contato dental']
      .map(q => ({ platform: 'meta', q, url: META(q, 'BR') })),
  ...['aspen dental', 'clearchoice', 'affordable dentures', 'byte aligners', 'invisalign', 'pacific dental',
      'heartland dental', 'tend dental', 'sage dental']
      .map(q => ({ platform: 'meta', q, url: META(q, 'US') })),
  { platform: 'google', q: 'odontocompany.com.br', url: GOOGLE('odontocompany.com.br', 'BR') },
  { platform: 'google', q: 'aspendental.com', url: GOOGLE('aspendental.com', 'US') },
  { platform: 'tiktok', q: 'dentista', url: TIKTOK('dentista', 'BR') },
  { platform: 'tiktok', q: 'dental implants', url: TIKTOK('dental implants', 'US') },
];

async function scrapeMeta(page) {
  await page.waitForSelector('text=/Started running on|Veiculação iniciada em|Começou a ser veiculado/i', { timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(1500); }
  return page.evaluate(() => {
    const cards = [];
    const nodes = Array.from(document.querySelectorAll('div')).filter(d =>
      /Started running on|Veiculação iniciada em/i.test(d.innerText || '') && (d.innerText || '').length < 4000);
    const seen = new Set();
    for (const n of nodes) {
      const t = n.innerText.trim();
      if (seen.has(t)) continue; seen.add(t);
      const link = n.querySelector('a[href*="l.facebook.com"], a[href^="http"]:not([href*="facebook.com/ads"])');
      const cta = Array.from(n.querySelectorAll('div[role="button"], a[role="button"]')).map(b => b.innerText.trim()).filter(Boolean).pop();
      cards.push({ text: t, cta, link: link ? link.href : null,
        video: !!n.querySelector('video'), images: n.querySelectorAll('img').length });
    }
    return cards;
  });
}

async function scrapeGeneric(page) {
  await page.waitForTimeout(8000);
  return page.evaluate(() => ({ text: document.body.innerText.slice(0, 20000) }));
}

const browser = await chromium.launch({ headless: true, proxy });
const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1400, height: 1000 } });
const results = [];
for (const t of targets) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const data = t.platform === 'meta' ? await scrapeMeta(page) : await scrapeGeneric(page);
    results.push({ ...t, status: resp?.status(), data });
  } catch (e) {
    results.push({ ...t, error: String(e) });
  } finally { await page.close(); }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}
await browser.close();
console.log('done ->', OUT);
