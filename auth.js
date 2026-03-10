// auth.js — Supabase-based auth for La Mafia Spy
import { supabase, supabaseAdmin } from './supabase.js';

/**
 * Registra um novo usuário no Supabase Auth e cria o perfil na tabela 'profiles'
 */
export async function registerUser({ name, email, password }) {
    try {
        // 1. Criar usuário no Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
        });

        if (authError) return { ok: false, msg: authError.message };
        if (!authData.user) return { ok: false, msg: 'Erro ao criar usuário.' };

        const userId = authData.user.id;
        const initials = name.trim().slice(0, 2).toUpperCase();

        // 2. Criar perfil na tabela 'profiles'
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .insert([{
                id: userId,
                name: name.trim(),
                email: email.toLowerCase().trim(),
                avatar_initials: initials,
                plan: 'free'
            }]);

        if (profileError) {
            console.error('Erro ao criar perfil:', profileError);
            // Mesmo se o perfil falhar, o usuário foi criado no Auth. 
            // Podíamos tentar deletar o user, mas vamos apenas retornar erro.
            return { ok: false, msg: 'Erro ao criar perfil de usuário.' };
        }

        return {
            ok: true,
            token: authData.session?.access_token || '',
            user: {
                id: userId,
                name,
                email,
                plan: 'free',
                avatar_initials: initials
            }
        };
    } catch (err) {
        console.error('Auth Register Error:', err);
        return { ok: false, msg: 'Erro interno no servidor de autenticação.' };
    }
}

/**
 * Login de usuário
 */
export async function loginUser({ email, password }) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) return { ok: false, msg: 'Credenciais inválidas ou erro no Supabase.' };

        // Buscar dados do perfil
        const { data: profile, error: pError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        if (pError) {
            console.error('Erro ao buscar perfil no login:', pError);
        }

        const user = profile ? {
            id: profile.id,
            name: profile.name,
            email: profile.email,
            plan: profile.plan,
            avatar_initials: profile.avatar_initials,
            created_at: profile.created_at
        } : {
            id: data.user.id,
            email: data.user.email,
            plan: 'free'
        };

        return { ok: true, token: data.session.access_token, user };
    } catch (err) {
        console.error('Auth Login Error:', err);
        return { ok: false, msg: 'Erro interno no login.' };
    }
}

/**
 * Valida o token JWT do Supabase
 */
export async function validateToken(token) {
    if (!token) return null;
    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) return null;

        // Buscar perfil
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        return profile || { id: data.user.id, email: data.user.email, plan: 'free' };
    } catch (err) {
        return null;
    }
}

/**
 * Logout (opcional no server-side com Supabase, mas bom ter)
 */
export async function logoutToken(token) {
    if (!token) return;
    await supabase.auth.admin.signOut(token);
}

/**
 * Middleware para proteger rotas Express
 */
export async function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token) return res.status(401).json({ detail: 'Não autenticado.', auth_required: true });

    const user = await validateToken(token);
    if (!user) return res.status(401).json({ detail: 'Sessão expirada ou inválida.', auth_required: true });

    req.user = user;
    next();
}
