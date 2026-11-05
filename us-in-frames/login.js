(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('loginForm');
  const button = $('loginButton');
  const errorNode = $('authError');
  const stateNode = $('authState');
  const client = window.US_IN_FRAMES_SUPABASE;
  let requestPending = false;
  let leaving = false;

  function goToLibrary() {
    if (leaving) return;
    leaving = true;
    stateNode.textContent = 'Signed in. Opening your library…';
    window.location.replace('./index.html');
  }

  if (!client) {
    button.disabled = true;
    errorNode.textContent = window.US_IN_FRAMES_SUPABASE_ERROR || 'Supabase is not configured. Check supabase-config.js.';
    return;
  }

  // The SDK restores its persisted session and emits INITIAL_SESSION on page load.
  client.auth.onAuthStateChange((_event, session) => {
    if (session) setTimeout(goToLibrary, 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    if (data.session) goToLibrary();
  }).catch(error => {
    console.error('Could not restore Supabase session:', error);
    errorNode.textContent = 'Could not check your saved sign-in. Please reload and try again.';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (requestPending || leaving) return;
    if (!form.reportValidity()) return;

    requestPending = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    errorNode.textContent = '';
    stateNode.textContent = 'Securely checking your sign-in…';

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: $('emailInput').value.trim(),
        password: $('passwordInput').value
      });
      if (error) throw error;
      if (!data.session) throw new Error('Supabase did not return a signed-in session. Please try again.');
      goToLibrary();
    } catch (error) {
      console.error('Supabase sign-in failed:', error);
      errorNode.textContent = error.message || 'Sign-in failed. Check your details and connection.';
      stateNode.textContent = '';
    } finally {
      requestPending = false;
      if (!leaving) {
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    }
  });
})();
