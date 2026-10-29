import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getAuthProvider, getSupabasePublicConfig } from './lib/supabase/config';
import { supabaseCookieName } from './lib/supabase/public-config';
import { canAccess, roleDestination, roleFromMetadata } from './lib/supabase/policy';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  function finish(target: NextResponse) {
    for (const cookie of response.cookies.getAll()) target.cookies.set(cookie);
    target.headers.set('Cache-Control', 'private, no-store');
    return target;
  }
  try {
    if (getAuthProvider() === 'legacy') return response;
    const { url, key } = getSupabasePublicConfig();
    const supabase = createServerClient(url, key, {
      cookieOptions: {
        name: supabaseCookieName(url),
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          for (const { name, value } of values) request.cookies.set(name, value);
          const previous = response;
          response = NextResponse.next({ request });
          for (const cookie of previous.cookies.getAll()) response.cookies.set(cookie);
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        },
      },
    });
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      const destination = new URL('/login', request.url);
      destination.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return finish(NextResponse.redirect(destination));
    }
    const role = roleFromMetadata(user);
    if (!role)
      return finish(
        NextResponse.json(
          { message: 'Sua conta não tem um perfil autorizado para este portal.' },
          { status: 403 },
        ),
      );
    if (!canAccess(role, request.nextUrl.pathname))
      return finish(NextResponse.redirect(new URL(roleDestination(role), request.url)));
    return finish(response);
  } catch {
    return finish(
      NextResponse.json(
        { message: 'A autenticação está temporariamente indisponível. Consulte a administração.' },
        { status: 503 },
      ),
    );
  }
}
export const config = { matcher: ['/portal/:path*', '/admin/:path*'] };
