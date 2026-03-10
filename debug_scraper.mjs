import { chromium } from './node_modules/playwright/index.mjs';

const keyword = process.argv[2] || 'curso online';
const country = process.argv[3] || 'BR';
const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country}&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered&media_type=all`;

console.log('URL:', url);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});
const page = await ctx.newPage();

try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Accept consent if needed
    for (const sel of ['button:has-text("Aceitar tudo")', 'button:has-text("Accept all")', 'button:has-text("Allow all cookies")']) {
        try { const b = page.locator(sel).first(); if (await b.isVisible({ timeout: 1500 })) { await b.click(); await page.waitForTimeout(2000); break; } } catch { }
    }

    await page.waitForTimeout(3000);

    const title = await page.title();
    console.log('Title:', title);
    console.log('Final URL:', page.url());

    // Get page text sample
    const text = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    console.log('\n=== PAGE TEXT ===\n', text);

    // Try ALL possible card selectors
    const allSelectors = {
        'data-ad-comet-id': '[data-ad-comet-id]',
        'role=article': '[role="article"]',
        'class _7jvw': 'div._7jvw',
        'class x8gbvx8': 'div[class*="x8gbvx8"]',
        'class xh8yej3': 'div[class*="xh8yej3"]',
        'class x1lliihq': 'div[class*="x1lliihq"]',
        'any div over 200 chars': null, // will do manually
    };

    for (const [name, sel] of Object.entries(allSelectors)) {
        if (!sel) continue;
        try {
            const count = await page.locator(sel).count();
            if (count > 0) console.log(`SELECTOR "${name}": ${count} elements`);
        } catch (e) { }
    }

    // Find large divs that might be ad cards
    const bigDivs = await page.evaluate(() => {
        const divs = document.querySelectorAll('div');
        const results = [];
        for (const div of divs) {
            const text = div.innerText || '';
            if (text.length > 100 && text.length < 2000 && div.children.length > 2) {
                const classes = div.className || '';
                results.push({ classes: classes.slice(0, 80), textLen: text.length, text: text.slice(0, 150) });
                if (results.length >= 10) break;
            }
        }
        return results;
    });
    console.log('\n=== BIG DIVS SAMPLE ===');
    bigDivs.forEach((d, i) => console.log(`[${i}] classes="${d.classes}" len=${d.textLen}\n  text: ${d.text}\n`));

} catch (e) {
    console.error('ERROR:', e.message);
} finally {
    await browser.close();
}
