import { createClient } from '@supabase/supabase-js'

const normalizeEnvValue = (value: unknown) => {
	if (typeof value !== 'string') {
		return ''
	}

	return value.trim().replace(/^['"]|['"]$/g, '')
}

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL
const rawSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseUrl = normalizeEnvValue(rawSupabaseUrl)
export const supabaseAnonKey = normalizeEnvValue(rawSupabaseAnonKey)

export const supabaseEnvState = {
	hasUrl: Boolean(supabaseUrl),
	hasAnonKey: Boolean(supabaseAnonKey),
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase =
	isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null
