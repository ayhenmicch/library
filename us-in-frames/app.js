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
  }

  async function loadLibrary() {
    if (loading) return;
    loading = true;
    setSyncState('Syncing…');
    try {
      const { data, error } = await client.from(TABLE).select('id, storage_path, caption, created_at').order('created_at', { ascending: false });
      if (error) throw error;
      if (!data.length) {
        photos = [];
      } else {
        const paths = data.map(row => row.storage_path);
        const { data: signed, error: signError } = await client.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
        if (signError) throw signError;
        const signedByPath = new Map((signed || []).map(item => [item.path, item.signedUrl]));
        photos = data.map(row => ({ ...row, signedUrl: signedByPath.get(row.storage_path) })).filter(photo => photo.signedUrl);
        if (photos.length !== data.length) console.error('Some images could not be signed; check Storage policies and object paths.');
      }
      render();
      setSyncState('Synced');
    } catch (error) {
      console.error('Unable to sync photo library:', error);
      setSyncState('Sync unavailable');
      flash(`Could not load the shared library: ${error.message || 'check your connection and Supabase policies'}`);
    } finally {
      loading = false;
    }
  }

  function openViewer(id, focus) {
    selectedId = id;
    previousFocus = focus || document.activeElement;
    const photo = photos.find(item => item.id === id);
    if (!photo) return;
    $('viewerImage').src = photo.signedUrl;
    $('viewerImage').alt = photo.caption || 'Selected photograph';
    $('viewerCaption').textContent = photo.caption || 'No caption yet.';
    viewer.classList.add('open');
    document.body.style.overflow = 'hidden';
    $('closeViewer').focus();
  }

  function closeViewer() {
    viewer.classList.remove('open');
    document.body.style.overflow = '';
    selectedId = null;
    if (previousFocus?.isConnected) previousFocus.focus();
  }

  function subscribeToLibrary() {
    if (channel) client.removeChannel(channel);
    channel = client.channel('shared-photo-library')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(loadLibrary, 250);
      })
      .subscribe(state => {
        if (state === 'SUBSCRIBED') setSyncState('Live sync on');
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setSyncState('Syncing on refresh');
      });
  }

  function openLegacyDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('us-in-frames', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('The existing photo database is busy. Close other library tabs and retry.'));
    });
  }

  async function readLegacyPhotos() {
    if (!('indexedDB' in window)) return [];
    let legacyDb;
    try { legacyDb = await openLegacyDatabase(); }
    catch (error) {
      if (error.name === 'NotFoundError') return [];
      throw error;
    }
    if (!legacyDb.objectStoreNames.contains('photos')) { legacyDb.close(); return []; }
    const result = await new Promise((resolve, reject) => {
      const request = legacyDb.transaction('photos', 'readonly').objectStore('photos').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    legacyDb.close();
    return result;
  }

  async function migrateLegacyPhotos() {
    let localPhotos;
    try { localPhotos = await readLegacyPhotos(); }
    catch (error) { console.warn('Could not read the legacy local photo library:', error); return; }
    if (!localPhotos.length) return;
    const { data: existing, error } = await client.from(TABLE).select('id');
    if (error) throw error;
    const known = new Set(existing.map(row => row.id));
    const handledLocalIds = new Set();
    let migrated = 0;
    for (const oldPhoto of localPhotos) {
      if (known.has(oldPhoto.id)) { handledLocalIds.add(oldPhoto.id); continue; }
      const blob = oldPhoto.image instanceof Blob ? oldPhoto.image : oldPhoto.image?.blob;
      if (!(blob instanceof Blob)) { console.warn(`Skipping legacy photo ${oldPhoto.id}: image data is missing.`); continue; }
      const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(oldPhoto.id) ? oldPhoto.id : crypto.randomUUID();
      const extension = (blob.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
      const path = `${id}/legacy.${extension}`;
      const { error: uploadError } = await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
      if (uploadError) { console.error('Legacy photo upload failed:', uploadError); continue; }
      const { error: insertError } = await client.from(TABLE).insert({ id, storage_path: path, caption: oldPhoto.caption || '', created_at: new Date(oldPhoto.createdAt || Date.now()).toISOString() });
      if (insertError) {
        await client.storage.from(BUCKET).remove([path]);
        console.error('Legacy photo metadata migration failed:', insertError);
        continue;
      }
      known.add(id);
      handledLocalIds.add(oldPhoto.id);
      migrated++;
    }
    if (migrated) flash(`${migrated} existing ${migrated === 1 ? 'photo was' : 'photos were'} copied to the shared library.`);
    if (handledLocalIds.size < localPhotos.length) flash('Some older photos could not be migrated. Their local copies remain in this browser.');
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
      for (const file of files) {
        const id = crypto.randomUUID();
        const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
        const path = `${id}/original.${extension}`;
        const { error: uploadError } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: insertError } = await client.from(TABLE).insert({ id, storage_path: path, caption: '', created_at: new Date().toISOString() });
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
    const { error } = await client.from(TABLE).update({ caption }).eq('id', photo.id);
    if (error) { console.error('Caption update failed:', error); flash(`Could not save caption: ${error.message}`); return; }
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
      const { error: rowError } = await client.from(TABLE).delete().eq('id', photo.id);
      if (rowError) throw rowError;
      const { error: objectError } = await client.storage.from(BUCKET).remove([photo.storage_path]);
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
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && client) loadLibrary(); });

  async function handleAuth(session) {
    if (!session) {
      activeUserId = null;
      if (channel) { await client.removeChannel(channel); channel = null; }
      photos = [];
      window.location.replace('./login.html');
      return;
    }
    if (activeUserId === session.user.id) return;
    activeUserId = session.user.id;
    document.body.classList.remove('auth-checking');
    $('signOut').hidden = false;
    $('addPhotos').disabled = false;
    try {
      await migrateLegacyPhotos();
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
