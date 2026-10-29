import { NextResponse } from 'next/server';
import { getAuthProvider, getSupabasePublicConfig } from '../../../lib/supabase/config';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const provider = getAuthProvider();
    if (provider === 'supabase') {
      const { url, key } = getSupabasePublicConfig();
      return NextResponse.json(
        { provider, configured: true, url, publishableKey: key },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return NextResponse.json(
      { provider, configured: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return NextResponse.json(
      {
        provider: 'supabase',
        configured: false,
        message: 'A autenticação está indisponível. Consulte a administração.',
      },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
