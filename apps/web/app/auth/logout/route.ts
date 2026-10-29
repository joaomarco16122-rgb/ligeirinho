import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthProvider, getSupabaseCookieName } from '../../../lib/supabase/config';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { sessionCookieNames } from '../../../lib/supabase/public-config';
import { isSameOrigin } from '../../../lib/supabase/policy';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: NextRequest) {
  // Foreign origins never mutate even a single cookie.
  if (!isSameOrigin(request))
    return NextResponse.json(
      { message: 'Origem da solicitação não autorizada.' },
      { status: 403, headers },
    );
  let base: string;
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    base = getSupabaseCookieName();
    store = await cookies();
  } catch {
    return NextResponse.json(
      {
        message: 'Não foi possível identificar a sessão local. Consulte a administração.',
        localSessionCleared: false,
        remoteRevoked: false,
      },
      { status: 503, headers },
    );
  }
  const initialNames = [...request.cookies.getAll(), ...store.getAll()].map(
    (cookie) => cookie.name,
  );
  let remoteRevoked = false;
  let status = 503;
  try {
    if (getAuthProvider() === 'supabase') {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      remoteRevoked = !error;
      status = remoteRevoked ? 200 : 503;
    } else status = 409;
  } catch {
    /* Cookie cleanup remains required when the SDK or network fails. */
  }
  const response = NextResponse.json(
    {
      message: remoteRevoked
        ? 'Sessão local encerrada e revogação confirmada.'
        : 'A sessão local foi removida. A revogação remota não pôde ser confirmada.',
      localSessionCleared: true,
      remoteRevoked,
    },
    { status, headers },
  );
  const names = sessionCookieNames(
    [...initialNames, ...store.getAll().map((cookie) => cookie.name)],
    base,
  );
  const options = {
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    expires: new Date(0),
  };
  for (const name of names) {
    store.set(name, '', options);
    response.cookies.set(name, '', options);
  }
  return response;
}
