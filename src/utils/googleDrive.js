/**
 * Google Drive integration for Ytics.
 *
 * Requires:
 *  - <script src="https://accounts.google.com/gsi/client" async defer></script>
 *  - <script src="https://apis.google.com/js/api.js" async defer></script>
 *  - REACT_APP_GOOGLE_CLIENT_ID env variable
 *
 * Uses Google Identity Services (token model) + gapi.client for Drive v3.
 */

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const MIME_ZIP = 'application/zip';

let tokenClient = null;
let gapiReady = false;
let gisReady = false;
let _accessToken = null;
let _onAuthChange = null; // callback

function getClientId() {
  return process.env.REACT_APP_GOOGLE_CLIENT_ID || '';
}

/** True when both gapi and GIS are loaded and a client ID is configured. */
export function isAvailable() {
  return !!getClientId();
}

// ── Initialization ──────────────────────────────────────────────────────────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureGapi() {
  if (gapiReady) return;
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve) => window.gapi.load('client', resolve));
  await window.gapi.client.init({});
  await window.gapi.client.load(DISCOVERY_DOC);
  gapiReady = true;
}

async function ensureGis() {
  if (gisReady) return;
  await loadScript('https://accounts.google.com/gsi/client');
  gisReady = true;
}

/**
 * Initialize Google Drive. Call once at app startup.
 * @param {Function} onAuthChange — called with { user, token } or null
 */
export async function initGoogleDrive(onAuthChange) {
  if (!isAvailable()) return;
  _onAuthChange = onAuthChange;

  await Promise.all([ensureGapi(), ensureGis()]);

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: getClientId(),
    scope: SCOPES,
    callback: '', // set per-request
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function notifyAuth(token) {
  _accessToken = token;
  if (_onAuthChange) {
    if (token) {
      // Fetch user profile
      fetchUserProfile().then(user => _onAuthChange({ user, token }));
    } else {
      _onAuthChange(null);
    }
  }
}

/**
 * Prompt user to sign in (shows consent popup).
 * Returns a promise that resolves with { user, token } on success.
 */
export function signIn() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error('Google Drive not initialized'));

    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      _accessToken = resp.access_token;
      fetchUserProfile().then(user => {
        if (_onAuthChange) _onAuthChange({ user, token: resp.access_token });
        resolve({ user, token: resp.access_token });
      });
    };

    if (_accessToken) {
      tokenClient.requestAccessToken({ prompt: '' }); // silent refresh
    } else {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    }
  });
}

/** Sign out — revokes token. */
export function signOut() {
  if (_accessToken) {
    window.google.accounts.oauth2.revoke(_accessToken);
    _accessToken = null;
  }
  notifyAuth(null);
}

export function getAccessToken() {
  return _accessToken;
}

async function fetchUserProfile() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${_accessToken}` },
    });
    if (!res.ok) return { name: 'Unknown', email: '', picture: '' };
    const data = await res.json();
    return { name: data.name, email: data.email, picture: data.picture };
  } catch {
    return { name: 'Unknown', email: '', picture: '' };
  }
}

// ── Helper: ensure we have a valid token, prompting if needed ───────────────

async function ensureToken() {
  if (!_accessToken) await signIn();
  if (!_accessToken) throw new Error('Not authenticated');
}

// ── File operations ─────────────────────────────────────────────────────────

/**
 * List .ytics files the user can see (owned + shared with them).
 * Returns [{ id, name, modifiedTime, owners, capabilities }]
 */
export async function listFiles(query = '') {
  await ensureToken();
  const q = query
    ? `name contains '${query.replace(/'/g, "\\'")}' and (mimeType='${MIME_ZIP}' or fileExtension='ytics') and trashed=false`
    : `(mimeType='${MIME_ZIP}' or fileExtension='ytics') and trashed=false`;

  const resp = await window.gapi.client.drive.files.list({
    q,
    fields: 'files(id,name,modifiedTime,owners,shared,capabilities,sharingUser,permissions)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
    spaces: 'drive',
  });

  return (resp.result.files || []).filter(f => f.name.endsWith('.ytics'));
}

/**
 * Get file metadata + permission level for the current user.
 * Returns { id, name, role, capabilities }
 *   role: 'owner' | 'writer' | 'commenter' | 'reader'
 */
export async function getFileInfo(fileId) {
  await ensureToken();
  const resp = await window.gapi.client.drive.files.get({
    fileId,
    fields: 'id,name,owners,capabilities,permissions,shared',
  });

  const file = resp.result;
  let role = 'reader';
  if (file.capabilities?.canEdit) role = 'writer';
  if (file.owners?.some(o => o.me)) role = 'owner';

  return { id: file.id, name: file.name, role, capabilities: file.capabilities };
}

/**
 * Download a .ytics file from Drive.
 * Returns an ArrayBuffer (the zip content).
 */
export async function downloadFile(fileId) {
  await ensureToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${_accessToken}` },
  });
  if (!resp.ok) throw new Error(`Failed to download: ${resp.status} ${resp.statusText}`);
  return await resp.arrayBuffer();
}

/**
 * Create a new .ytics file on Drive.
 * @param {string} name - File name (e.g. "My Dashboard.ytics")
 * @param {Blob} blob - The zip blob
 * @returns {{ id, name }}
 */
export async function createFile(name, blob) {
  await ensureToken();

  const metadata = {
    name: name.endsWith('.ytics') ? name : name + '.ytics',
    mimeType: MIME_ZIP,
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST', headers: { Authorization: `Bearer ${_accessToken}` }, body: form }
  );

  if (!resp.ok) throw new Error(`Failed to create file: ${resp.status}`);
  return await resp.json();
}

/**
 * Update an existing .ytics file on Drive.
 * @param {string} fileId
 * @param {Blob} blob - The zip blob
 * @param {string} [newName] - Optional new file name
 * @returns {{ id, name }}
 */
export async function updateFile(fileId, blob, newName) {
  await ensureToken();

  const url = newName
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name`
    : `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name`;

  let resp;
  if (newName) {
    const metadata = { name: newName.endsWith('.ytics') ? newName : newName + '.ytics' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);
    resp = await fetch(url, {
      method: 'PATCH', headers: { Authorization: `Bearer ${_accessToken}` }, body: form,
    });
  } else {
    resp = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': MIME_ZIP },
      body: blob,
    });
  }

  if (!resp.ok) throw new Error(`Failed to update file: ${resp.status}`);
  return await resp.json();
}
