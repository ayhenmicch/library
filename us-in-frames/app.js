(() => {
  'use strict';

  const TABLE = 'photos';
  const BUCKET = 'us-in-frames';
  const SIGNED_URL_SECONDS = 3600;
  const $ = id => document.getElementById(id);
  const gallery = $('gallery');
  const fileInput = $('fileInput');
  const viewer = $('viewer');
  const captionDialog = $('captionDialog');
  const captionInput = $('captionInput');
  let client;
  let photos = [];
  let selectedId = null;
  let previousFocus = null;
  let channel = null;
  let loading = false;
  let loadAgain = false;
  let activeUserId = null;
  let refreshTimer;

  function flash(message, persistent = false) {
    const node = $('status');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(flash.timer);
    if (!persistent) flash.timer = setTimeout(() => node.classList.remove('show'), 3500);
  }

  function setSyncState(text) { $('syncState').textContent = text; }
  function render() {
    gallery.replaceChildren();
    $('photoCount').textContent = `${photos.length} ${photos.length === 1 ? 'photograph' : 'photographs'}`;
    if (!photos.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      const title = document.createElement('strong');
      title.textContent = 'Your story starts here.';
      const copy = document.createTextNode('Add the photographs you want to keep close.');
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = 'Choose photographs';
      add.addEventListener('click', () => fileInput.click());
      empty.append(title, copy, add);
      gallery.append(empty);
      return;
    }
    photos.forEach(photo => {
      const item = document.createElement('figure');
      item.className = 'photo';
      const img = document.createElement('img');
      img.src = photo.signedUrl;
      img.alt = photo.caption || 'Saved photograph';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.alt = 'Photograph could not be loaded. Refresh the page to try again.';
        console.error(`Image load failed for photo ${photo.id}`);
      }, { once: true });
      const caption = document.createElement('figcaption');
      caption.className = 'caption';
      caption.textContent = photo.caption || '';
      item.append(img, caption);
      item.addEventListener('click', () => openViewer(photo.id, item));
      gallery.append(item);
    });
    if (viewer.classList.contains('open')) updateViewerPhoto();
  }

  async function loadLibrary() {
    if (!activeUserId) return;
    if (loading) { loadAgain = true; return; }
    const ownerId = activeUserId;
    loading = true;
    setSyncState('Syncing…');
    try {
      const { data, error } = await client.from(TABLE).select('id, user_id, storage_path, caption, created_at').eq('user_id', ownerId).order('created_at', { ascending: false });
      if (error) throw error;
      if (!data.length) {
        if (activeUserId !== ownerId) return;
        photos = [];
      } else {
        const paths = data.map(row => row.storage_path);
        const { data: signed, error: signError } = await client.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
        if (signError) throw signError;
        if (activeUserId !== ownerId) return;
        const signedByPath = new Map((signed || []).map(item => [item.path, item.signedUrl]));
        photos = data.map(row => ({ ...row, signedUrl: signedByPath.get(row.storage_path) })).filter(photo => photo.signedUrl);
        if (photos.length !== data.length) console.error('Some images could not be signed; check Storage policies and object paths.');
      }
      render();
      setSyncState('Synced');
    } catch (error) {
      if (activeUserId !== ownerId) return;
      console.error('Unable to sync photo library:', error);
      setSyncState('Sync unavailable');
      flash(`Could not load the shared library: ${error.message || 'check your connection and Supabase policies'}`);
    } finally {
      loading = false;
      if (loadAgain) {
        loadAgain = false;
        if (activeUserId) void loadLibrary();
      }
    }
  }

  function openViewer(id, focus) {
    selectedId = id;
    previousFocus = focus || document.activeElement;
    const photo = photos.find(item => item.id === id);
    if (!photo) return;
    viewer.classList.add('open');
    document.body.style.overflow = 'hidden';
    updateViewerPhoto();
    $('closeViewer').focus();
  }

  function updateViewerPhoto() {
    const index = photos.findIndex(item => item.id === selectedId);
    if (index < 0) {
      closeViewer();
      return false;
    }
    const photo = photos[index];
    $('viewerImage').src = photo.signedUrl;
    $('viewerImage').alt = photo.caption || 'Selected photograph';
    $('viewerCaption').textContent = photo.caption || 'No caption yet.';
    $('viewerCounter').textContent = `${index + 1} / ${photos.length}`;
    return true;
  }

  function navigateViewer(direction) {
    if (!viewer.classList.contains('open') || !photos.length) return;
    const currentIndex = photos.findIndex(item => item.id === selectedId);
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (startIndex + direction + photos.length) % photos.length;
    selectedId = photos[nextIndex].id;
    updateViewerPhoto();
  }

  function closeViewer() {
    viewer.classList.remove('open');
    document.body.style.overflow = '';
    selectedId = null;
    swipeStart = null;
    $('viewerImage').removeAttribute('src');
    $('viewerCounter').textContent = '';
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  $('previousPhoto').addEventListener('click', () => navigateViewer(-1));
  $('nextPhoto').addEventListener('click', () => navigateViewer(1));

  let swipeStart = null;
  $('viewerImage').addEventListener('touchstart', event => {
    const touch = event.changedTouches[0];
    swipeStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  $('viewerImage').addEventListener('touchend', event => {
    if (!swipeStart) return;
    if (!viewer.classList.contains('open')) { swipeStart = null; return; }
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    navigateViewer(deltaX < 0 ? 1 : -1);
  }, { passive: true });

  function subscribeToLibrary() {
    if (channel) client.removeChannel(channel);
    const ownerId = activeUserId;
    channel = client.channel('shared-photo-library')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${ownerId}` }, payload => {
        const changedUserId = payload.new?.user_id ?? payload.old?.user_id;
        if (activeUserId !== ownerId || changedUserId !== ownerId) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(loadLibrary, 250);
      })
      .subscribe(state => {
        if (state === 'SUBSCRIBED') setSyncState('Live sync on');
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setSyncState('Syncing on refresh');
      });
  }

  async function authenticatedUserId() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user || data.user.id !== activeUserId) throw new Error('Your sign-in changed. Reload the page and sign in again.');
    return data.user.id;
  }

  $('signOut').addEventListener('click', async () => {
    const button = $('signOut');
    button.disabled = true;
    setSyncState('Signing out…');
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Sign out failed:', error);
      flash(`Could not sign out: ${error.message || 'please try again'}`);
      button.disabled = false;
      setSyncState('Live sync on');
    }
  });
  $('addPhotos').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async event => {
    const files = [...event.target.files].filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    const button = $('addPhotos');
    button.disabled = true;
    button.textContent = 'Uploading…';
    let uploaded = 0;
    try {
      const userId = await authenticatedUserId();
      for (const file of files) {
        if (activeUserId !== userId) throw new Error('Your sign-in changed during upload. Reload and try again.');
        const id = crypto.randomUUID();
        const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
        const path = `${userId}/${id}.${extension}`;
        const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: insertError } = await client.from(TABLE).insert({ id, user_id: userId, storage_path: path, caption: '', created_at: new Date().toISOString() });
        if (insertError) {
          await client.storage.from(BUCKET).remove([path]);
          throw insertError;
        }
        uploaded++;
      }
      await loadLibrary();
      flash(`${uploaded} ${uploaded === 1 ? 'photograph' : 'photographs'} uploaded to the shared library.`);
    } catch (error) {
      console.error('Photo upload failed:', error);
      await loadLibrary();
      flash(`Upload stopped after ${uploaded} of ${files.length}: ${error.message || 'check Storage and database policies'}`);
    } finally {
      button.disabled = false;
      button.innerHTML = '＋ &nbsp;Add photographs';
      fileInput.value = '';
    }
  });

  $('closeViewer').addEventListener('click', closeViewer);
  viewer.addEventListener('click', event => { if (event.target === viewer) closeViewer(); });
  $('editCaption').addEventListener('click', () => {
    const photo = photos.find(item => item.id === selectedId);
    if (!photo) return;
    captionInput.value = photo.caption || '';
    captionDialog.classList.add('open');
    captionInput.focus();
  });
  $('cancelCaption').addEventListener('click', () => captionDialog.classList.remove('open'));
  captionDialog.addEventListener('click', event => { if (event.target === captionDialog) captionDialog.classList.remove('open'); });
  $('saveCaption').addEventListener('click', async () => {
    const photo = photos.find(item => item.id === selectedId);
    if (!photo) return;
    const caption = captionInput.value.trim();
    const ownerId = activeUserId;
    const { error } = await client.from(TABLE).update({ caption }).eq('id', photo.id).eq('user_id', ownerId);
    if (error) { console.error('Caption update failed:', error); flash(`Could not save caption: ${error.message}`); return; }
    if (activeUserId !== ownerId) return;
    photo.caption = caption;
    render();
    $('viewerCaption').textContent = caption || 'No caption yet.';
    $('viewerImage').alt = caption || 'Selected photograph';
    captionDialog.classList.remove('open');
    $('editCaption').focus();
  });
  $('deletePhoto').addEventListener('click', async () => {
    const photo = photos.find(item => item.id === selectedId);
    if (!photo) return;
    const button = $('deletePhoto');
    button.disabled = true;
    try {
      const userId = await authenticatedUserId();
      if (photo.user_id !== userId || !photo.storage_path.startsWith(`${userId}/`)) throw new Error('This photo is not in the current user’s library.');
      const { error: rowError } = await client.from(TABLE).delete().eq('id', photo.id).eq('user_id', userId);
      if (rowError) throw rowError;
      const { error: objectError } = await client.storage.from(BUCKET).remove([photo.storage_path]);
      if (activeUserId !== userId) return;
      photos = photos.filter(item => item.id !== photo.id);
      render();
      closeViewer();
      $('viewerImage').removeAttribute('src');
      if (objectError) {
        console.error('Photo row deleted, but Storage cleanup failed:', objectError);
        flash(`Photo removed from library, but its stored file could not be cleaned up: ${objectError.message}`);
      } else flash('Photograph deleted from the shared library.');
    } catch (error) {
      console.error('Photo deletion failed:', error);
      flash(`Could not delete photograph: ${error.message}`);
    } finally { button.disabled = false; }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (captionDialog.classList.contains('open')) { captionDialog.classList.remove('open'); $('editCaption').focus(); }
      else if (viewer.classList.contains('open')) closeViewer();
    } else if (viewer.classList.contains('open') && !captionDialog.classList.contains('open')) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigateViewer(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); navigateViewer(1); }
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && client) loadLibrary(); });

  async function handleAuth(session) {
    if (!session) {
      activeUserId = null;
      document.body.classList.add('auth-checking');
      photos = [];
      render();
      if (viewer.classList.contains('open')) closeViewer();
      $('viewerImage').removeAttribute('src');
      if (channel) { await client.removeChannel(channel); channel = null; }
      window.location.replace('./login.html');
      return;
    }
    if (activeUserId === session.user.id) return;
    if (activeUserId && activeUserId !== session.user.id) {
      photos = [];
      render();
      if (viewer.classList.contains('open')) closeViewer();
      $('viewerImage').removeAttribute('src');
      if (channel) { await client.removeChannel(channel); channel = null; }
    }
    activeUserId = session.user.id;
    document.body.classList.remove('auth-checking');
    $('signOut').hidden = false;
    $('addPhotos').disabled = false;
    try {
      await loadLibrary();
      subscribeToLibrary();
    } catch (error) {
      console.error('Library setup failed:', error);
      setSyncState('Setup needed');
      flash(`Could not connect to shared storage: ${error.message}`);
    }
  }

  function start() {
    client = window.US_IN_FRAMES_SUPABASE;
    if (!client) {
      setSyncState('Configuration needed');
      document.body.classList.remove('auth-checking');
      gallery.innerHTML = '<div class="empty"><strong>Library setup needed.</strong>Open login.html and check your Supabase setup.</div>';
      return;
    }
    client.auth.onAuthStateChange((_event, session) => {
      // Defer Supabase calls out of the auth callback to avoid blocking its internal lock.
      setTimeout(() => handleAuth(session).catch(error => {
        console.error('Session handling failed:', error);
        setSyncState('Session error');
      }), 0);
    });
  }

  start();
})();
