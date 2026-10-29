import { NextResponse, type NextRequest } from 'next/server';
import { getAuthProvider } from '../../../lib/supabase/config';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import {
  canAccess,
  roleDestination,
  roleFromMetadata,
  safeReturnPath,
} from '../../../lib/supabase/policy';
export const dynamic = 'force-dynamic';
function failed(request: NextRequest) {
  const location = new URL('/login', request.url);
  location.searchParams.set('error', 'supabase_callback');
  return NextResponse.redirect(location, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function GET(request: NextRequest) {
  try {
    if (getAuthProvider() !== 'supabase') return failed(request);
    const code = request.nextUrl.searchParams.get('code');
    if (!code || code.length > 4096) return failed(request);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failed(request);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    const role = user && roleFromMetadata(user);
    if (userError || !user || !role) {
      await supabase.auth.signOut({ scope: 'local' });
      return failed(request);
    }
    const fallback = roleDestination(role);
    const proposed = safeReturnPath(request.nextUrl.searchParams.get('next'), fallback);
    const destination = canAccess(role, new URL(proposed, request.url).pathname)
      ? proposed
      : fallback;
    return NextResponse.redirect(new URL(destination, request.url), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return failed(request);
  }
}
