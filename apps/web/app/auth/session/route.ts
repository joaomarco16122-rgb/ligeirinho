import { NextResponse } from 'next/server';
import { getAuthProvider } from '../../../lib/supabase/config';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { roleFromMetadata } from '../../../lib/supabase/policy';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  try {
    if (getAuthProvider() !== 'supabase')
      return NextResponse.json(
        { message: 'Este ambiente não utiliza sessão Supabase.' },
        { status: 409, headers },
      );
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user)
      return NextResponse.json(
        { message: 'Entre novamente para continuar.' },
        { status: 401, headers },
      );
    const role = roleFromMetadata(user);
    if (!role)
      return NextResponse.json(
        { message: 'A conta não tem um perfil autorizado.' },
        { status: 403, headers },
      );
    // getUser above is the authorization check. getSession is used only to extract
    // the access token that belongs to that verified user for the API exchange.
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session || session.user.id !== user.id)
      return NextResponse.json(
        { message: 'Entre novamente para continuar.' },
        { status: 401, headers },
      );
    return NextResponse.json(
      { accessToken: session.access_token, user: { id: user.id, email: user.email ?? '', role } },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { message: 'A autenticação está temporariamente indisponível. Consulte a administração.' },
      { status: 503, headers },
    );
  }
}
