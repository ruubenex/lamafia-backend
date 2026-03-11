import express from 'express';
import cors from 'cors';
import { scrapeAds, scrapePageLibrary, generateInsights } from './scraper.js';
import { runWatcher } from './watcher.js';
import {
    getWatchlist, addToWatchlist, removeFromWatchlist, updateWatchlistItem,
    getAlerts, addAlert, removeAlert, updateAlertCount,
    getLibraries, addLibrary, removeLibrary, updateLibrarySnapshot,
    getSwipeFile, addToSwipeFile, removeFromSwipeFile,
} from './db.js';

import { registerUser, loginUser, validateToken, logoutToken, requireAuth } from './auth.js';

const app = express();
const PORT = process.env.PORT || 8000;

const ALLOWED_ORIGINS = [
    'https://lamafia.online',
    'https://www.lamafia.online',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'null',
];

app.use(cors({
    origin: (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.includes('localhost')) cb(null, true);
        else cb(null, true);
    },
    exposedHeaders: ['x-auth-token']
}));
app.use(express.json());

// ─── HEALTH ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    status: 'ok', version: '2.5', name: 'La Mafia Spy', database: 'supabase'
}));

// ─── AUTH ────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || !password)
        return res.status(400).json({ detail: 'Preencha todos os campos.' });
    if (password.length < 6)
        return res.status(400).json({ detail: 'Senha deve ter ao menos 6 caracteres.' });
    const result = await registerUser({ name, email, password });
    if (!result.ok) return res.status(400).json({ detail: result.msg });
    res.json(result);
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email?.trim() || !password)
        return res.status(400).json({ detail: 'E-mail e senha são obrigatórios.' });
    const result = await loginUser({ email, password });
    if (!result.ok) return res.status(401).json({ detail: result.msg });
    res.json(result);
});

app.post('/auth/logout', async (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) await logoutToken(token);
    res.json({ ok: true });
});

app.get('/auth/me', async (req, res) => {
    const token = req.headers['x-auth-token'];
    const user = await validateToken(token);
    if (!user) return res.status(401).json({ detail: 'Não autenticado.', auth_required: true });
    res.json({ user });
});

// ─── SEARCH (Protected) ─────────────────────────────────
app.post('/search', requireAuth, async (req, res) => {
    const {
        keywords = '', min_copies = 1, country = 'BR',
        ad_type = 'all', max_results = 50,
        active_status = 'all', media_type = 'all'
    } = req.body;

    if (!keywords.trim()) return res.status(400).json({ detail: 'Keywords cannot be empty.' });

    const searchUrl = `https://www.facebook.com/ads/library/?active_status=${active_status}&ad_type=${ad_type}&country=${country}&q=${encodeURIComponent(keywords)}&search_type=keyword_unordered&media_type=${media_type}`;

    try {
        const results = await scrapeAds({
            keywords, min_copies, country, ad_type,
            max_results: Math.min(max_results, 100), // cap at 100 to avoid Render timeout
            active_status, media_type
        });
        res.json({ total: results.length, results, search_url: searchUrl });
    } catch (err) {
        res.status(500).json({ detail: `Erro: ${err.message}` });
    }
});

// ─── TRANSCRIPTION ────────────────────────────────────────
app.post('/transcribe', requireAuth, async (req, res) => {
    const { text, source_lang = 'auto' } = req.body;
    if (!text?.trim()) return res.status(400).json({ detail: 'Text is required.' });

    try {
        const encoded = encodeURIComponent(text.slice(0, 500));
        const langPair = source_lang === 'auto' || source_lang === 'pt' ? 'en|pt' : `${source_lang}|pt`;

        const response = await fetch(
            `https://api.mymemory.translated.net/get?q=${encoded}&langpair=${langPair}&de=lamafiaspy@gmail.com`,
            { signal: AbortSignal.timeout(8000) }
        );
        const data = await response.json();

        const translated = data?.responseData?.translatedText || '';
        const detectedLang = data?.responseData?.detectedLanguage || source_lang;
        const isSameLang = translated.toLowerCase().trim() === text.toLowerCase().trim() || detectedLang.startsWith('pt');

        res.json({
            original: text,
            translated: isSameLang ? text : translated,
            detected_language: detectedLang,
            is_portuguese: isSameLang,
        });
    } catch (err) {
        res.json({ original: text, translated: text, detected_language: 'unknown', error: err.message });
    }
});

// ─── WATCHLIST (Protected) ──────────────────────────────
app.get('/watchlist', requireAuth, async (req, res) => {
    try {
        const list = await getWatchlist(req.user.id);
        res.json(list);
    } catch (err) { res.status(500).json({ detail: err.message }); }
});

app.post('/watchlist', requireAuth, async (req, res) => {
    const result = await addToWatchlist(req.user.id, req.body);
    if (!result.ok) return res.status(409).json(result);
    res.json(result);
});

app.delete('/watchlist/:id', requireAuth, async (req, res) => {
    await removeFromWatchlist(req.user.id, req.params.id);
    res.json({ ok: true });
});

app.post('/watchlist/:id/analyze', requireAuth, async (req, res) => {
    const list = await getWatchlist(req.user.id);
    const item = list.find(i => i.id === req.params.id || i.library_id === req.params.id);
    if (!item) return res.status(404).json({ detail: 'Not found' });

    try {
        const results = await scrapeAds({ keywords: item.page_name || '', min_copies: 1, country: item.country || 'BR', max_results: 10 });
        const match = results.find(r => r.library_id === item.library_id);
        if (match) await updateWatchlistItem(req.user.id, item.library_id, match);
        res.json({ ok: true, updated: match || null });
    } catch (err) { res.status(500).json({ detail: err.message }); }
});

// ─── ALERTS (Protected) ─────────────────────────────────
app.get('/alerts', requireAuth, async (req, res) => {
    try { res.json(await getAlerts(req.user.id)); }
    catch (err) { res.status(500).json({ detail: err.message }); }
});

app.post('/alerts', requireAuth, async (req, res) => {
    const { keyword, country = 'BR' } = req.body;
    if (!keyword?.trim()) return res.status(400).json({ detail: 'Keyword required.' });
    const alert = await addAlert(req.user.id, keyword.trim(), country);
    res.json(alert);
});

app.delete('/alerts/:id', requireAuth, async (req, res) => {
    await removeAlert(req.user.id, req.params.id);
    res.json({ ok: true });
});

// ─── LIBRARY ANALYZER (Protected) ──────────────────────
app.get('/libraries', requireAuth, async (req, res) => {
    try { res.json(await getLibraries(req.user.id)); }
    catch (err) { res.status(500).json({ detail: err.message }); }
});

app.post('/libraries', requireAuth, async (req, res) => {
    const { url, label, country = 'BR' } = req.body;
    if (!url?.trim()) return res.status(400).json({ detail: 'URL required.' });
    try {
        const lib = await addLibrary(req.user.id, { url: url.trim(), label: label?.trim() || url.trim(), country });
        res.json(lib);
    } catch (err) { res.status(500).json({ detail: err.message }); }
});

app.delete('/libraries/:id', requireAuth, async (req, res) => {
    await removeLibrary(req.user.id, req.params.id);
    res.json({ ok: true });
});

app.post('/libraries/:id/analyze', requireAuth, async (req, res) => {
    // Set a longer timeout header for slow scrapes
    req.socket.setTimeout(90000);

    const list = await getLibraries(req.user.id);
    const lib = list.find(l => l.id === req.params.id);
    if (!lib) return res.status(404).json({ detail: 'Library not found.' });

    try {
        const ads = await scrapePageLibrary({ pageUrl: lib.url, country: lib.country || 'BR', max_results: 50 });

        if (!ads || ads.length === 0) {
            return res.json({ ok: false, detail: 'Nenhum anúncio encontrado nesta biblioteca. Verifique a URL.', total_ads: 0, insights: null, ads: [] });
        }

        const insights = generateInsights(ads);
        await updateLibrarySnapshot(req.user.id, lib.id, ads, insights);
        res.json({ ok: true, total_ads: ads.length, insights, ads: ads.slice(0, 50) });
    } catch (err) {
        console.error('Library analyze error:', err.message);
        res.status(500).json({ detail: `Erro na análise: ${err.message}` });
    }
});

// ─── SWIPE FILE (Public GET, Protected POST/DELETE) ─────
app.get('/swipefile', async (req, res) => {
    try {
        const { niche, offer_type, creative_type, is_scaling, q } = req.query;
        const list = await getSwipeFile({ niche, offer_type, creative_type, is_scaling, query: q });
        res.json(list);
    } catch (err) {
        console.error('SwipeFile GET error:', err.message);
        res.status(500).json({ detail: err.message });
    }
});

app.post('/swipefile', requireAuth, async (req, res) => {
    try {
        const id = await addToSwipeFile(req.user.id, req.body);
        res.json({ ok: true, id });
    } catch (err) { res.status(500).json({ detail: err.message }); }
});

app.delete('/swipefile/:id', requireAuth, async (req, res) => {
    await removeFromSwipeFile(req.user.id, req.params.id);
    res.json({ ok: true });
});

// ─── DOWNLOAD PROXY (Protected) ─────────────────────────
app.get('/download', requireAuth, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ detail: 'url param required' });
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://www.facebook.com/',
            },
        });
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'attachment; filename="criativo_la_mafia"');
        response.body.pipe(res);
    } catch (err) { res.status(500).json({ detail: 'Download failed: ' + err.message }); }
});

// ─── START ───────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n👁️  La Mafia Spy — v2.5 (Supabase + Swipe File + Filtros)`);
    console.log(`🚀 Backend: http://localhost:${PORT}`);
    runWatcher().catch(console.error);
});
