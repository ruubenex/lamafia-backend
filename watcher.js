// watcher.js — Async Supabase watcher for La Mafia Spy
import { supabaseAdmin } from './supabase.js';
import { scrapeAds } from './scraper.js';
import { updateWatchlistItem, updateAlertCount, getWatchlist, getAlerts } from './db.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function runWatcher() {
    console.log('\n👁️  [La Mafia Spy] Watcher iniciado — monitoramento diário ativo');
    await checkAllWatchlists();
    await checkAllAlerts();
    setInterval(async () => {
        console.log('\n🔄 [Watcher] Rodando ciclo diário...');
        await checkAllWatchlists();
        await checkAllAlerts();
    }, INTERVAL_MS);
}

/**
 * Busca todos os usuários e verifica os itens de cada watchlist
 */
async function checkAllWatchlists() {
    try {
        // Fetch all users who have watchlist items
        const { data: allItems, error } = await supabaseAdmin
            .from('watchlist')
            .select('*');

        if (error || !allItems?.length) return;

        console.log(`\n📋 [Watcher] Verificando ${allItems.length} itens do watchlist de todos os usuários...`);

        for (const item of allItems) {
            try {
                const results = await scrapeAds({
                    keywords: item.page_name || '',
                    min_copies: 1,
                    country: item.country || 'BR',
                    max_results: 10,
                });
                const match = results.find(r => r.library_id === item.library_id);
                if (match) {
                    await updateWatchlistItem(item.user_id, item.library_id, match);
                    const diff = (match.copies || 1) - (item.copies || 0);
                    if (Math.abs(diff) >= 5) {
                        console.log(`  ${diff > 0 ? '🔥' : '📉'} [${item.page_name}] ${diff > 0 ? '+' : ''}${diff} cópias`);
                    }
                }
            } catch (e) {
                console.error(`  ❌ Erro ao monitorar ${item.page_name}: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 3000)); // rate limit
        }
        console.log('✅ [Watcher] Watchlist atualizado.');
    } catch (err) {
        console.error('❌ [Watcher] Erro em checkAllWatchlists:', err.message);
    }
}

/**
 * Busca todos os alertas de todos os usuários e verifica
 */
async function checkAllAlerts() {
    try {
        const { data: alerts, error } = await supabaseAdmin
            .from('alerts')
            .select('*');

        if (error || !alerts?.length) return;

        console.log(`\n🔔 [Watcher] Verificando ${alerts.length} alertas...`);

        for (const alert of alerts) {
            try {
                const results = await scrapeAds({
                    keywords: alert.keyword,
                    min_copies: 1,
                    country: alert.country || 'BR',
                    max_results: 20,
                });
                await updateAlertCount(alert.user_id, alert.id, results.length);
                console.log(`  🔔 [${alert.keyword}] → ${results.length} anúncios encontrados`);
            } catch (e) {
                console.error(`  ❌ Erro no alerta "${alert.keyword}": ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    } catch (err) {
        console.error('❌ [Watcher] Erro em checkAllAlerts:', err.message);
    }
}
