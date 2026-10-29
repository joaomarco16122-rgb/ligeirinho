import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabasePublicConfig } from './config';
import { supabaseCookieName } from './public-config';

export async function createSupabaseServerClient() {
  const { url, key } = getSupabasePublicConfig();
  const store = await cookies();
  return createServerClient(url, key, {
    cookieOptions: {
      name: supabaseCookieName(url),
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values) store.set(name, value, options);
      },
    },
  });
}
