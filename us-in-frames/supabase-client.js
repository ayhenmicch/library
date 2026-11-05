(() => {
  'use strict';

  const config = window.SUPABASE_CONFIG;
  const projectUrl = String(config?.NEXT_PUBLIC_SUPABASE_URL || config?.url || '').trim().replace(/\/+$/, '');
  const publicKey = String(config?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || config?.NEXT_PUBLIC_SUPABASE_ANON_KEY || config?.anonKey || config?.publishableKey || '').trim();
  const knownTemplateUrl = projectUrl === 'https://YOUR_PROJECT_ID.supabase.co';
  const knownTemplateKey = publicKey === 'sb_publishable_YOUR_KEY' || publicKey === 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY';
  const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl);
  const isSecretKey = /^(sb_secret_|.*service_role)/i.test(publicKey);
  const invalid = !projectUrl || !publicKey || knownTemplateUrl || knownTemplateKey || !validUrl || isSecretKey;

  if (invalid || !window.supabase?.createClient) {
    window.US_IN_FRAMES_SUPABASE_ERROR = invalid
      ? 'Supabase URL or public key is missing or still contains a template value.'
      : 'Supabase JavaScript did not load. Check the internet connection and reload.';
    return;
  }

  // Bound Auth token requests so a lost connection cannot leave the login UI busy forever.
  // Other requests, especially photo uploads, are not given this short authentication timeout.
  const authTimeoutFetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('/auth/v1/token')) return fetch(input, init);

    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromCaller = () => controller.abort(externalSignal.reason);
    if (externalSignal) {
      if (externalSignal.aborted) abortFromCaller();
      else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(new DOMException('Authentication request timed out.', 'TimeoutError')), 18000);
    return fetch(input, { ...init, signal: controller.signal }).catch(error => {
      if (controller.signal.reason?.name === 'TimeoutError') {
        throw new Error('The sign-in request timed out. Check your connection and try again.');
      }
      throw error;
    }).finally(() => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    });
  };

  window.US_IN_FRAMES_SUPABASE = window.supabase.createClient(projectUrl, publicKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    global: { fetch: authTimeoutFetch }
  });
})();
