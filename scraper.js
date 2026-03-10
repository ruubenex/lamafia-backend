import { chromium } from './node_modules/playwright/index.mjs';

function buildSearchUrl(keywords, country = 'BR', adType = 'all', activeStatus = 'all') {
    return (
        `https://www.facebook.com/ads/library/` +
        `?active_status=${activeStatus}&ad_type=${adType}` +
        `&country=${country}` +
        `&q=${encodeURIComponent(keywords)}` +
        `&search_type=keyword_unordered&media_type=all`
    );
}

function buildPageLibraryUrl(pageId, country = 'BR', activeStatus = 'all') {
    // pageId can be numeric ID or FB page slug
    const isNumeric = /^\d+$/.test(pageId);
    if (isNumeric) {
        return `https://www.facebook.com/ads/library/?active_status=${activeStatus}&ad_type=all&country=${country}&view_all_page_id=${pageId}&search_type=page`;
    }
    // If it's a URL, extract page id from it
    const m = pageId.match(/view_all_page_id=(\d+)/);
    if (m) return `https://www.facebook.com/ads/library/?active_status=${activeStatus}&ad_type=all&country=${country}&view_all_page_id=${m[1]}&search_type=page`;
    // If it's a page slug, navigate to the slug's library
    const slug = pageId.replace(/https?:\/\/(www\.)?facebook\.com\//, '').replace(/\?.*/, '').replace(/\//, '');
    return `https://www.facebook.com/${slug}/about/?show_switched_toast=false`;
}

/** ─── PARSERS ──────────────────────────────────── */

/**
 * parseCopies — Extracts the number of ad copies from Facebook ad text.
 * 
 * Priority order (most reliable first):
 * 1. "X anúncios usam esse criativo" — most reliable (exact count)
 * 2. "X versões" / "X versão" — also reliable
 * 3. "várias versões" without number — treat as 3 (conservative)
 * 4. Any "versions" keyword — treat as 2
 * 5. Otherwise: 1 copy
 */
function parseCopies(text) {
    // HIGHEST PRIORITY: "X anúncios usam esse criativo" or "X ads use this creative"
    let m = text.match(/(\d[\d.,]*)\s*anúnci[oo]s?\s+usam/i);
    if (m) return Math.max(1, parseInt(m[1].replace(/[.,]/g, '')));
    m = text.match(/(\d[\d.,]*)\s*ads?\s+use\s+this/i);
    if (m) return Math.max(1, parseInt(m[1].replace(/[.,]/g, '')));

    // Explicit version count patterns (PT/EN)
    m = text.match(/(\d[\d.,]*)\s*vers[\u00f5o]es?/i);
    if (m) return Math.max(1, parseInt(m[1].replace(/[.,]/g, '')));
    m = text.match(/(\d[\d.,]*)\s*c[o\u00f3]pias?/i);
    if (m) return Math.max(1, parseInt(m[1].replace(/[.,]/g, '')));
    m = text.match(/(\d[\d,]*)\s+cop(?:y|ies)/i);
    if (m) return Math.max(1, parseInt(m[1].replace(/,/g, '')));
    m = text.match(/runs\s+(\d+)\s+cop/i);
    if (m) return Math.max(1, parseInt(m[1]));

    // "várias versões" / "multiple versions" without explicit count → treat as 3
    if (/v[aá]rias vers[\u00f5o]es|multiple versions|several versions/i.test(text)) return 3;
    // Has a "versions" marker at all → 2
    if (/vers[\u00f5o]es?|versions?/i.test(text)) return 2;
    return 1;
}

function parseDate(text) {
    const m = text.match(/(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i);
    if (m) return m[1];
    const m2 = text.match(/([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/);
    if (m2) return m2[1];
    return '';
}

function parsePlatforms(text) {
    const p = [];
    if (/facebook/i.test(text)) p.push('Facebook');
    if (/instagram/i.test(text)) p.push('Instagram');
    if (/messenger/i.test(text)) p.push('Messenger');
    if (/audience network/i.test(text)) p.push('Audience Network');
    return p.length ? p : ['Facebook'];
}

function parseDaysRunning(text) {
    const start = parseDate(text);
    if (!start) return 0;
    try {
        const months = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
        const parts = start.replace(/de /g, '').split(' ').filter(Boolean);
        const day = parseInt(parts[0]);
        const mon = months[parts[1]?.slice(0, 3).toLowerCase()] ?? 0;
        const year = parseInt(parts[2]);
        const date = new Date(year, mon, day);
        return Math.max(0, Math.floor((Date.now() - date) / 86400000));
    } catch { return 0; }
}

/** Extract 'hook' — first meaningful sentence, skipping metadata */
function extractHook(allCleanLines) {
    for (const line of allCleanLines) {
        if (line.length < 15) continue;
        // skip anything that looks like metadata
        if (/identificação|library ID|veiculação|anúnci[oo]s? usam|vers[õo]es?|\d{4,}/i.test(line)) continue;
        const sentence = line.split(/[.!?]/)[0].trim();
        if (sentence.length > 10) return sentence.slice(0, 150);
    }
    return '';
}

/** Extract emotional triggers found in ad text */
function extractTriggers(text) {
    const triggers = [];
    if (/grátis|free|gratuito/i.test(text)) triggers.push('🎁 Gratuito');
    if (/promoção|desconto|off|oferta|promo/i.test(text)) triggers.push('🏷️ Promoção');
    if (/urgente|agora|limitado|últimas|últimos|last chance|hurry/i.test(text)) triggers.push('⏳ Urgência');
    if (/provado|comprovado|garant|proven|guaranteed/i.test(text)) triggers.push('✅ Prova Social');
    if (/resultado|transforma|antes e depois|before.*after/i.test(text)) triggers.push('📈 Resultado');
    if (/segredo|exclusivo|secret|exclusive/i.test(text)) triggers.push('🔐 Exclusividade');
    if (/medo|perda|perca|lose|miss out|risco/i.test(text)) triggers.push('😨 Medo/Perda');
    if (/feliz|amor|paixão|happy|love|passion/i.test(text)) triggers.push('❤️ Emoção');
    if (/dor|sofrimento|problema|pain|problem|suffer/i.test(text)) triggers.push('😣 Dor/Problema');
    if (/r\$\s*\d|€\s*\d|\$\s*\d|preço|price/i.test(text)) triggers.push('💰 Preço');
    return triggers;
}

function calcScore(copies, daysRunning, platforms, isActive, hasMultipleVersions) {
    let score = 0;
    if (copies >= 50) score += 40;
    else if (copies >= 20) score += 32;
    else if (copies >= 10) score += 24;
    else if (copies >= 5) score += 16;
    else if (copies >= 2) score += 8;
    else score += 2;
    if (daysRunning >= 90) score += 30;
    else if (daysRunning >= 60) score += 24;
    else if (daysRunning >= 30) score += 18;
    else if (daysRunning >= 14) score += 10;
    else if (daysRunning >= 7) score += 5;
    score += Math.min(platforms.length * 5, 15);
    if (isActive) score += 10;
    if (hasMultipleVersions) score += 5;
    return Math.min(score, 100);
}

function scoreLabel(score) {
    if (score >= 80) return { label: '🔥 Escalando', color: 'scaling' };
    if (score >= 60) return { label: '📈 Crescendo', color: 'growing' };
    if (score >= 40) return { label: '➡️ Estável', color: 'stable' };
    return { label: '📉 Testando', color: 'testing' };
}

// Lines that are ENTIRELY skip-worthy (exact or starts-with)
const SKIP = /^(Patrocinado|Sponsored|Inativo|Ativo|Inactive|Active|Plataformas|Platforms|Transparência da página|Abrir menu suspenso|Abrir menu|Ver detalhes do anúncio|Ver detalhes|Identificação da biblioteca|Library ID|Esse anúncio tem|This ad has|Aprenda mais|Learn More|Saiba mais|Comprar agora|Shop Now|Inscreva-se|Subscribe|Começar|Get Started|Assinar|Curtir página|Like Page|Enviar mensagem|Send message|Ver resumo|Ocultar|Mostrar|Ver mais|Reportar|Copiar link|Compartilhar|Reagir|Comentar|Enviar|anúncios? usam esse criativo|anúncios? usam|uses this creative|Veiculação iniciada|Started running|Criativo e texto)$/i;
// Lines that match metadata patterns mid-string
const META = /^[\d,.]+$|^\d{1,2}\s+de\s+\w+\s+de\s+\d{4}|^0:\d{2}|identificação da biblioteca|Library ID\s*:|veiculação iniciada|\d+\s+anúnci[oo]s?\s+usam|\d+\s+ads?\s+use/i;
// UI noise — CTA buttons that are browser UI, not actual ad CTAs
const UI_NOISE = /^(Abrir menu suspenso|Abrir menu|Ver detalhes|Ver resumo|Ocultar|Mostrar|Reagir|Comentar|Enviar|Compartilhar|Copiar|Reportar|Ajuda|Configurações|Saiba mais sobre|Fechar|Ok|Cancelar)$/i;

async function launchBrowser() {
    return await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
}

async function setupPage(browser) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'pt-BR',
    });
    return await context.newPage();
}

async function dismissConsent(page) {
    for (const sel of [
        'button:has-text("Aceitar tudo")',
        'button:has-text("Accept all")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Aceitar e fechar")',
        '[data-cookiebanner="accept_button"]',
    ]) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); await page.waitForTimeout(2000); break; }
        } catch { /**/ }
    }
}

async function extractCardData(card, cardText, country) {
    const idMatch = cardText.match(/(?:Identificação da biblioteca|Library ID)[:\s]+(\d+)/i);
    if (!idMatch) return null;
    const libId = idMatch[1];
    const copies = parseCopies(cardText);
    const isActive = !/inativo|inactive/i.test(cardText);
    const hasMultipleVersions = /v[aá]rias vers[õo]es|multiple versions|several versions/i.test(cardText);
    const daysRunning = parseDaysRunning(cardText);
    const platforms = parsePlatforms(cardText);
    const score = calcScore(copies, daysRunning, platforms, isActive, hasMultipleVersions);
    const trend = scoreLabel(score);

    let pageName = '';
    try {
        const links = await card.$$('a[href*="facebook.com"]');
        for (const link of links) {
            const href = await link.getAttribute('href') || '';
            if (href.includes('/ads/library') || href.includes('ads_library')) continue;
            const t = (await link.innerText()).trim();
            if (t.length > 1 && t.length < 100) { pageName = t; break; }
        }
    } catch { /**/ }
    if (!pageName) {
        const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
        const si = lines.findIndex(l => /patrocinado|sponsored/i.test(l));
        if (si > 0) pageName = lines[si - 1];
    }

    let adLink = '';
    try {
        const el = await card.$('a[href*="/ads/library/"]');
        if (el) { adLink = await el.getAttribute('href') || ''; if (adLink && !adLink.startsWith('http')) adLink = 'https://www.facebook.com' + adLink; }
    } catch { /**/ }
    if (!adLink) adLink = `https://www.facebook.com/ads/library/?id=${libId}`;

    let pageLink = '';
    try {
        const el = await card.$('a[href*="facebook.com"]:not([href*="/ads/library"])');
        if (el) pageLink = await el.getAttribute('href') || '';
    } catch { /**/ }

    let mediaUrl = '', mediaType = 'none';
    try {
        const video = await card.$('video');
        if (video) { mediaUrl = await video.getAttribute('src') || await video.getAttribute('poster') || ''; mediaType = mediaUrl ? 'video' : 'none'; }
        if (!mediaUrl) {
            const img = await card.$('img[src*="fbcdn"]:not([src*="emoji"]):not([width="16"])');
            if (img) { mediaUrl = await img.getAttribute('src') || ''; mediaType = mediaUrl ? 'image' : 'none'; }
        }
        if (!mediaUrl) {
            const img2 = await card.$('img');
            if (img2) { const src = await img2.getAttribute('src') || ''; if (src && !src.includes('emoji') && src.length > 20) { mediaUrl = src; mediaType = 'image'; } }
        }
    } catch { /**/ } // CTA text — only real ad CTA buttons, skip browser UI
    let ctaText = '';
    try {
        const buttons = await card.$$('[role="button"]:not([aria-label*="menu"]):not([aria-label*="fechar"]):not([aria-label*="close"])');
        for (const btn of buttons) {
            const t = (await btn.innerText()).trim();
            if (t && t.length > 1 && t.length < 50 && !UI_NOISE.test(t)) { ctaText = t; break; }
        }
    } catch { /**/ }

    // Ad text — aggressively clean all metadata lines
    const allLines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
    const cleanLines = allLines.filter(l =>
        !SKIP.test(l.trim()) &&
        !META.test(l.trim()) &&
        l.length > 4 &&
        l !== '\u200b' &&
        !/^\d+\s*(anúnci[oo]|ad)/i.test(l)  // skip "2 anúncios usam..."
    );
    const adText = cleanLines.slice(0, 6).join(' | ').slice(0, 500);
    const hook = extractHook(cleanLines);
    const triggers = extractTriggers(adText);

    // Extract destination domain from any outbound link in card
    let destDomain = '';
    try {
        const links = await card.$$('a[href]');
        for (const link of links) {
            const href = await link.getAttribute('href') || '';
            if (href.startsWith('http') && !href.includes('facebook.com') && !href.includes('fb.com')) {
                try { destDomain = new URL(href).hostname.replace('www.', ''); break; } catch { /**/ }
            }
        }
    } catch { /**/ }

    return {
        page_name: pageName || '—',
        ad_text: adText,
        hook,
        triggers,
        copies,
        platforms,
        start_date: parseDate(cardText),
        days_running: daysRunning,
        is_active: isActive,
        has_multiple_versions: hasMultipleVersions,
        score,
        trend: trend.label,
        trend_color: trend.color,
        cta_text: ctaText,
        media_url: mediaUrl,
        media_type: mediaType,
        ad_link: adLink,
        page_link: pageLink,
        library_id: libId,
        dest_domain: destDomain,
        country,
    };
}

async function scrollAndCollect(page, maxResults, minCopies, activeFilter, seen, results) {
    let scrollRound = 0;
    while (results.length < maxResults && scrollRound < 30) {
        const cards = await page.$$('div[class*="x1plvlek"][class*="xryxfnj"]');
        console.log(`  Round ${scrollRound + 1}: ${cards.length} candidate cards`);

        for (const card of cards) {
            if (results.length >= maxResults) break;
            let cardText = '';
            try { cardText = await card.innerText(); } catch { continue; }
            if (!/Identificação da biblioteca|Library ID/i.test(cardText)) continue;

            const idMatch = cardText.match(/(?:Identificação da biblioteca|Library ID)[:\s]+(\d+)/i);
            if (!idMatch) continue;
            if (seen.has(idMatch[1])) continue;

            const copies = parseCopies(cardText);
            const isActive = !/inativo|inactive/i.test(cardText);

            // Active/inactive filter
            if (activeFilter === 'active' && !isActive) continue;
            if (activeFilter === 'inactive' && isActive) continue;

            // Copies filter — KEY FIX: treat "várias versões" as copies ≥ 2
            if (copies < minCopies) continue;

            const data = await extractCardData(card, cardText, 'BR');
            if (!data) continue;
            seen.add(idMatch[1]);
            results.push(data);
            console.log(`  ✓ [${data.copies}x | ${data.score}pts | ${isActive ? '🟢' : '🔴'}] ${data.page_name}`);
        }

        if (results.length >= maxResults) break;
        const prevH = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.evaluate(() => window.scrollBy(0, 3000));
        await page.waitForTimeout(2200);
        const newH = await page.evaluate(() => document.documentElement.scrollHeight);
        if (newH === prevH && scrollRound > 2) { console.log('  ↙ Reached bottom.'); break; }
        scrollRound++;
    }
}

/** ─── MAIN KEYWORD SEARCH ─────────────────────── */
export async function scrapeAds({ keywords, min_copies = 1, country = 'BR', ad_type = 'all', max_results = 50, active_status = 'all' }) {
    const url = buildSearchUrl(keywords, country, ad_type, active_status);
    console.log(`🔍 [Scraper] "${keywords}" | country=${country} | min_copies=${min_copies} | active=${active_status}`);
    console.log(`   URL: ${url}`);

    const results = [];
    const browser = await launchBrowser();
    try {
        const page = await setupPage(browser);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        await dismissConsent(page);
        await page.waitForTimeout(3000);
        await scrollAndCollect(page, max_results, min_copies, active_status, new Set(), results);
    } catch (err) { console.error('❌ Scraper error:', err.message); }
    finally { await browser.close(); }

    console.log(`✅ Done. ${results.length} ads matched (before min_copies post-filter).`);
    // Post-filter: ensure min_copies is strictly applied after scraping
    const filtered = min_copies > 1 ? results.filter(r => (r.copies || 1) >= min_copies) : results;
    console.log(`✅ After min_copies=${min_copies} filter: ${filtered.length} ads.`);
    return filtered;
}

/** ─── LIBRARY ANALYZER (by page ID or page URL) ─ */
export async function scrapePageLibrary({ pageUrl, country = 'BR', max_results = 200, active_status = 'all' }) {
    // Extract page id from various URL formats
    let pageId = pageUrl.trim();
    // https://www.facebook.com/ads/library/?view_all_page_id=123456
    let m = pageId.match(/view_all_page_id=(\d+)/);
    if (m) pageId = m[1];
    // https://www.facebook.com/SomePage
    else {
        m = pageId.match(/facebook\.com\/([^/?&\n]+)/);
        if (m && m[1] && m[1] !== 'ads') pageId = m[1]; // could be slug or numeric
    }

    // Build the library URL
    const isNumericId = /^\d{5,}$/.test(pageId);
    let url;
    if (isNumericId) {
        url = `https://www.facebook.com/ads/library/?active_status=${active_status}&ad_type=all&country=${country}&view_all_page_id=${pageId}&search_type=page`;
    } else {
        // Use keyword search as fallback with the page name
        url = `https://www.facebook.com/ads/library/?active_status=${active_status}&ad_type=all&country=${country}&q=${encodeURIComponent(pageId)}&search_type=page`;
    }

    console.log(`📚 [Library Analyzer] pageId=${pageId} | URL: ${url}`);
    const results = [];
    const browser = await launchBrowser();

    try {
        const page = await setupPage(browser);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        await dismissConsent(page);
        await page.waitForTimeout(3000);
        await scrollAndCollect(page, max_results, 1, 'all', new Set(), results);
    } catch (err) { console.error('❌ Library Analyzer error:', err.message); }
    finally { await browser.close(); }

    console.log(`✅ Library: ${results.length} ads found.`);
    return results;
}

/** ─── GENERATE LIBRARY INSIGHTS ──────────────── */
export function generateInsights(ads) {
    if (!ads.length) return null;

    const active = ads.filter(a => a.is_active);
    const inactive = ads.filter(a => !a.is_active);
    const scores = ads.map(a => a.score || 0);
    const copies = ads.map(a => a.copies || 1);
    const topAds = [...ads].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    const allTriggers = ads.flatMap(a => a.triggers || []);

    // Trigger frequency
    const triggerCount = {};
    allTriggers.forEach(t => { triggerCount[t] = (triggerCount[t] || 0) + 1; });
    const topTriggers = Object.entries(triggerCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => ({ trigger: t, count: c }));

    // Platform distribution
    const platCount = {};
    ads.forEach(a => (a.platforms || []).forEach(p => { platCount[p] = (platCount[p] || 0) + 1; }));

    // CTA distribution
    const ctaCount = {};
    ads.forEach(a => { if (a.cta_text) ctaCount[a.cta_text] = (ctaCount[a.cta_text] || 0) + 1; });
    const topCTAs = Object.entries(ctaCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => ({ cta: c, count: n }));

    // Avg days running
    const avgDays = Math.round(ads.filter(a => a.days_running).reduce((s, a) => s + (a.days_running || 0), 0) / (ads.filter(a => a.days_running).length || 1));

    // Scaling & testing
    const scalingAds = ads.filter(a => a.trend_color === 'scaling');
    const testingAds = ads.filter(a => a.trend_color === 'testing');

    // Hooks swipe file (top hooks)
    const hooks = ads.filter(a => a.hook && a.hook.length > 10).map(a => ({ hook: a.hook, score: a.score, copies: a.copies })).sort((a, b) => b.score - a.score).slice(0, 10);

    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const maxCopies = Math.max(...copies);
    const totalCopies = copies.reduce((a, b) => a + b, 0);

    // Recommendation
    let recommendation = '';
    if (scalingAds.length > 0) recommendation = `🔥 ${scalingAds.length} criativo(s) escalando! Estude os hooks e CTAs deles.`;
    else if (active.length === 0) recommendation = '⚠️ Nenhum anúncio ativo. Esta página pode ter pausado suas campanhas.';
    else if (avgScore >= 60) recommendation = '📈 Biblioteca saudável com criativos de alta performance. Ótima referência.';
    else recommendation = '🧪 Muitos anúncios em fase de teste. Acompanhe nos próximos dias.';

    return {
        total_ads: ads.length,
        active_count: active.length,
        inactive_count: inactive.length,
        avg_score: avgScore,
        max_copies: maxCopies,
        total_copies: totalCopies,
        avg_days_running: avgDays,
        scaling_count: scalingAds.length,
        testing_count: testingAds.length,
        platform_distribution: platCount,
        top_triggers: topTriggers,
        top_ctas: topCTAs,
        top_ads: topAds,
        hooks_swipe_file: hooks,
        recommendation,
    };
}
