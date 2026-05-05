// ── Google Drive Integration ─────────────────────────────────────────────────
// Lean integration: OAuth + Google Picker + download/upload via REST.
// No gapi.client dependency — just fetch calls to Drive v3 REST API.

const CLIENT_ID = '581124812922-gu6l8bilhilm8dg144sqkar2h81h9npf.apps.googleusercontent.com';
const APP_ID = '581124812922';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient = null;
let accessToken = null;
let pickerLoaded = false;

// ── Script loading ───────────────────────────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureGisLoaded() {
  await loadScript('https://accounts.google.com/gsi/client');
}

async function ensurePickerLoaded() {
  await loadScript('https://apis.google.com/js/api.js');
  if (!pickerLoaded) {
    await new Promise((resolve, reject) => {
      window.gapi.load('picker', { callback: resolve, onerror: reject });
    });
    pickerLoaded = true;
  }
}

// ── Authentication ───────────────────────────────────────────────────────────

async function ensureToken() {
  if (accessToken) {
    // Quick validation
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + accessToken);
      if (res.ok) return accessToken;
    } catch { /* expired */ }
    accessToken = null;
  }

  await ensureGisLoaded();

  return new Promise((resolve) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          resolve(null);
          return;
        }
        accessToken = response.access_token;
        resolve(accessToken);
      },
    });
    tokenClient.requestAccessToken();
  });
}

// ── Google Picker ────────────────────────────────────────────────────────────

export async function pickFile() {
  const token = await ensureToken();
  if (!token) return null;

  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const docsView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setMimeTypes('application/zip,application/octet-stream')
      .setQuery('.ytics');

    const picker = new window.google.picker.PickerBuilder()
      .addView(docsView)
      .addView(new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS))
      .setOAuthToken(token)
      .setAppId(APP_ID)
      .setTitle('Open .ytics file from Google Drive')
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const file = data.docs[0];
          resolve({ id: file.id, name: file.name });
        } else if (data.action === window.google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();

    picker.setVisible(true);
  });
}

// ── File operations ──────────────────────────────────────────────────────────

export async function downloadFile(fileId) {
  const token = await ensureToken();
  if (!token) throw new Error('Google authorization required');

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return res.arrayBuffer();
}

export async function createFile(name, blob) {
  const token = await ensureToken();
  if (!token) throw new Error('Google authorization required');

  const metadata = {
    name: name.endsWith('.ytics') ? name : name + '.ytics',
    mimeType: 'application/zip',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
  return res.json();
}

export async function updateFile(fileId, blob) {
  const token = await ensureToken();
  if (!token) throw new Error('Google authorization required');

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/zip',
      },
      body: blob,
    }
  );
  if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
  return res.json();
}
