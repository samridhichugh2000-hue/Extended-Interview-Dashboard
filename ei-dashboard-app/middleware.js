import { NextResponse } from 'next/server';

// NJ weekly check-in links are meant to work with no login at all, and the
// per-feed sync route authenticates with its own SYNC_TRIGGER_SECRET header
// (called by an external scheduler, not a browser) — neither can go through
// a Basic Auth prompt, so both stay outside the password gate below.
const PUBLIC_PATHS = ['/respond', '/api/weekly-response', '/api/sync'];

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const [, password] = atob(auth.slice(6)).split(':');
    if (password === process.env.DASHBOARD_PASSWORD) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="EI Dashboard"' },
  });
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
