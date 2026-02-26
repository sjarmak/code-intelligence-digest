'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const redirect = searchParams.get('redirect') || '/';
  const authError = searchParams.get('error');
  const callbackUrl =
    typeof window !== 'undefined' && redirect.startsWith('/')
      ? `${window.location.origin}${redirect}`
      : redirect;

  useEffect(() => {
    fetch('/api/auth-config')
      .then((res) => res.ok ? res.json() : { googleEnabled: false })
      .then((data) => setGoogleEnabled(data?.googleEnabled === true))
      .catch(() => setGoogleEnabled(false));
  }, []);

  useEffect(() => {
    if (!googleEnabled) return;
    fetch('/api/auth/csrf')
      .then((res) => res.json())
      .then((data) => setCsrfToken(data?.csrfToken ?? null))
      .catch(() => setCsrfToken(null));
  }, [googleEnabled]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="flex items-center justify-center gap-3">
          <h1 className="text-3xl font-bold">Code Intelligence Digest</h1>
          <img
            src="/icons/cid_book_prompt.svg"
            alt=""
            className="h-10 w-10 shrink-0"
          />
        </div>

        {authError === 'Configuration' && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
            <p className="font-medium">Sign-in configuration error</p>
            <p className="mt-2">Check the following and restart the dev server:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li><code className="bg-amber-100 px-1 rounded">AUTH_SECRET</code> is set (e.g. <code className="bg-amber-100 px-1 rounded">openssl rand -base64 32</code>)</li>
              <li><code className="bg-amber-100 px-1 rounded">AUTH_GOOGLE_ID</code> and <code className="bg-amber-100 px-1 rounded">AUTH_GOOGLE_SECRET</code> are set for Google sign-in</li>
              <li>In Google Cloud Console, add the correct redirect URI: local dev <code className="bg-amber-100 px-1 rounded break-all">http://localhost:3002/api/auth/callback/google</code>; production <code className="bg-amber-100 px-1 rounded break-all">https://code-intelligence-digest.onrender.com/api/auth/callback/google</code></li>
              <li>On Render (production): set <code className="bg-amber-100 px-1 rounded">NEXTAUTH_URL</code>=<code className="bg-amber-100 px-1 rounded">https://code-intelligence-digest.onrender.com</code> (no trailing slash) so sign-in and sign-out use the public URL, not localhost</li>
            </ul>
          </div>
        )}

        {googleEnabled && csrfToken && (
          <div className="mt-8">
            <form
              action="/api/auth/signin/google"
              method="POST"
              className="w-full"
            >
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <button
                type="submit"
                className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </button>
            </form>
          </div>
        )}

        {googleEnabled && !csrfToken && (
          <p className="mt-4 text-center text-sm text-gray-500">
            Loading sign-in…
          </p>
        )}

        {!googleEnabled && !authError && (
          <p className="mt-4 text-center text-sm text-gray-500">
            Sign-in is not configured. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET to enable Google sign-in.
          </p>
        )}
      </div>
    </div>
  );
}
