import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERRO: SUPABASE_URL ou SUPABASE_KEY não configurados no .env');
}

// Cliente público para operações básicas
export const supabase = createClient(supabaseUrl, supabaseKey);

// Cliente administrativo para bypassar RLS ou criar usuários diretamente se necessário
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);

console.log('✅ Cliente Supabase inicializado');
