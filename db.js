// db.js — Supabase-based database for La Mafia Spy
import { supabase, supabaseAdmin } from './supabase.js';

function today() { return new Date().toISOString().slice(0, 10); }

// ─── WATCHLIST ─────────────────────────────────────────
export async function getWatchlist(userId) {
    if (!userId) return [];
    const { data, error } = await supabaseAdmin
        .from('watchlist')
        .select('*')
        .eq('user_id', userId)
        .order('added_at', { ascending: false });

    if (error) { console.error('DB Error getWatchlist:', error); return []; }
    return data || [];
}

export async function addToWatchlist(userId, ad) {
    if (!userId) return { ok: false, msg: 'Usuário não identificado.' };

    // Check if already in watchlist
    const { data: existing } = await supabaseAdmin
        .from('watchlist')
        .select('id')
        .eq('user_id', userId)
        .eq('library_id', ad.library_id)
        .single();

    if (existing) return { ok: false, msg: 'Já está no watchlist.' };

    const item = {
        user_id: userId,
        library_id: ad.library_id,
        page_name: ad.page_name,
        page_url: ad.page_url,
        copies: ad.copies || 1,
        score: ad.score || 0,
        trend_direction: 'stable',
        folder: ad.folder || 'Geral',
        media_url: ad.media_url || ad.video_src || ad.thumbnail,
        media_type: ad.media_type || (ad.video_src ? 'video' : 'image'),
        dest_domain: ad.dest_domain || '',
        history: [{ date: today(), copies: ad.copies || 1, score: ad.score || 0 }],
    };

    const { data, error } = await supabaseAdmin
        .from('watchlist')
        .insert([item])
        .select();

    if (error) { console.error('DB Error addToWatchlist:', error); return { ok: false, msg: 'Erro ao salvar no banco.' }; }
    return { ok: true, item: data[0] };
}

export async function removeFromWatchlist(userId, id) {
    const { error } = await supabaseAdmin
        .from('watchlist')
        .delete()
        .eq('user_id', userId)
        .or(`id.eq.${id},library_id.eq.${id}`);

    if (error) { console.error('DB Error removeFromWatchlist:', error); return { ok: false }; }
    return { ok: true };
}

export async function updateWatchlistItem(userId, id, snapshot) {
    // Buscar item atual para atualizar o histórico
    const { data: item } = await supabaseAdmin
        .from('watchlist')
        .select('history, copies')
        .eq('user_id', userId)
        .or(`id.eq.${id},library_id.eq.${id}`)
        .single();

    if (!item) return;

    const history = item.history || [];
    const todayStr = today();
    const existing = history.find(h => h.date === todayStr);

    if (existing) {
        existing.copies = snapshot.copies;
        existing.score = snapshot.score;
    } else {
        history.push({ date: todayStr, copies: snapshot.copies, score: snapshot.score });
    }

    const updatedHistory = history.slice(-30); // Ultimos 30 dias

    // Calcular trend
    let trend = 'stable';
    if (updatedHistory.length >= 2) {
        const last = updatedHistory[updatedHistory.length - 1].copies;
        const prev = updatedHistory[updatedHistory.length - 2].copies;
        const diff = last - prev;
        if (diff >= 10) trend = 'scaling';
        else if (diff >= 2) trend = 'growing';
        else if (diff <= -5) trend = 'falling';
    }

    await supabaseAdmin
        .from('watchlist')
        .update({
            copies: snapshot.copies,
            score: snapshot.score,
            history: updatedHistory,
            trend_direction: trend
        })
        .eq('user_id', userId)
        .or(`id.eq.${id},library_id.eq.${id}`);
}

// ─── ALERTS ─────────────────────────────────────────────
export async function getAlerts(userId) {
    if (!userId) return [];
    const { data, error } = await supabaseAdmin
        .from('alerts')
        .select('*')
        .eq('user_id', userId);

    if (error) return [];
    return data || [];
}

export async function addAlert(userId, keyword, country = 'BR') {
    const { data, error } = await supabaseAdmin
        .from('alerts')
        .insert([{ user_id: userId, keyword, country, new_count: 0 }])
        .select();

    if (error) return null;
    return data[0];
}

export async function removeAlert(userId, id) {
    await supabaseAdmin
        .from('alerts')
        .delete()
        .eq('user_id', userId)
        .eq('id', id);
}

export async function updateAlertCount(userId, id, count) {
    await supabaseAdmin
        .from('alerts')
        .update({ new_count: count, last_checked: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('id', id);
}

// ─── LIBRARIES ─────────────────────────────────────
export async function getLibraries(userId) {
    const { data } = await supabaseAdmin.from('libraries').select('*').eq('user_id', userId);
    return data || [];
}

export async function addLibrary(userId, { url, label, country = 'BR' }) {
    const { data, error } = await supabaseAdmin
        .from('libraries')
        .insert([{ user_id: userId, url, label: label || url, country }])
        .select();
    return data ? data[0] : null;
}

export async function removeLibrary(userId, id) {
    await supabaseAdmin.from('libraries').delete().eq('user_id', userId).eq('id', id);
}

export async function updateLibrarySnapshot(userId, id, ads, insights) {
    const { data: lib } = await supabaseAdmin.from('libraries').select('snapshots').eq('id', id).single();
    if (!lib) return;

    const snap = {
        date: today(),
        total: ads.length,
        active: ads.filter(a => a.is_active || a.status === 'active').length,
        avg_score: insights?.avg_score || 0,
        max_copies: insights?.max_copies || 0
    };

    const snapshots = [...(lib.snapshots || []), snap].slice(-30);

    await supabaseAdmin
        .from('libraries')
        .update({ last_checked: new Date().toISOString(), insights, snapshots })
        .eq('id', id);
}

// ─── SWIPE FILE (PUBLIC — all users share it) ─────────────────────────
export async function getSwipeFile({ niche, offer_type, creative_type, is_scaling, query } = {}) {
    let q = supabaseAdmin
        .from('swipe_file')
        .select('*')
        .order('saved_at', { ascending: false })
        .limit(500);

    if (niche) q = q.eq('niche', niche);
    if (offer_type) q = q.eq('offer_type', offer_type);
    if (creative_type) q = q.eq('creative_type', creative_type);
    if (is_scaling === 'true' || is_scaling === true) q = q.eq('is_scaling', true);
    if (is_scaling === 'false' || is_scaling === false) q = q.eq('is_scaling', false);
    if (query) q = q.ilike('content', `%${query}%`);

    const { data } = await q;
    return data || [];
}

export async function addToSwipeFile(userId, item) {
    const { data, error } = await supabaseAdmin
        .from('swipe_file')
        .insert([{
            user_id: userId,
            type: item.type || item.category,
            content: item.content || item.text,
            original_ad_id: item.original_ad_id || item.library_id,
            page_name: item.page_name || item.source,
            niche: item.niche || null,
            offer_type: item.offer_type || null,
            creative_type: item.creative_type || (item.media_type === 'video' ? 'video' : item.media_type === 'image' ? 'imagem' : null),
            is_scaling: item.is_scaling || (item.score >= 80) || false,
            copies: item.copies || null,
            score: item.score || null,
            ad_link: item.ad_link || null,
            media_url: item.media_url || null,
            media_type: item.media_type || null,
        }])
        .select();
    return data ? data[0].id : null;
}

export async function removeFromSwipeFile(userId, id) {
    // Only owner can delete
    await supabaseAdmin.from('swipe_file').delete().eq('user_id', userId).eq('id', id);
}
