import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  isAvailable,
  signIn,
  signOut,
  getAccessToken,
  listFiles,
  getFileInfo,
  downloadFile,
  createFile,
  updateFile,
} from '../utils/googleDrive';
import { exportDashboardBlob, importDashboardFromBuffer } from '../utils/exportUtils';

/**
 * Google Drive integration modal.
 * Provides: Sign in/out, browse files, open, save, save-as.
 */
export default function DrivePicker({ onClose }) {
  const { state, dispatch } = useApp();
  const [tab, setTab] = useState('open'); // 'open' | 'save'
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [saveName, setSaveName] = useState(state.dashboard.title || 'My Dashboard');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);

  const isSignedIn = !!getAccessToken();

  const loadFiles = useCallback(async (query = '') => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFiles(query);
      setFiles(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn && tab === 'open') {
      loadFiles();
    }
  }, [isSignedIn, tab, loadFiles]);

  const handleSignIn = async () => {
    setError(null);
    try {
      const { user } = await signIn();
      dispatch({ type: 'SET_DRIVE_USER', payload: user });
      loadFiles();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSignOut = () => {
    signOut();
    dispatch({ type: 'SET_DRIVE_USER', payload: null });
    dispatch({ type: 'CLEAR_DRIVE_FILE' });
    setFiles([]);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadFiles(search);
  };

  const handleOpen = async (file) => {
    setLoading(true);
    setError(null);
    try {
      // Get file info to determine permission
      const info = await getFileInfo(file.id);
      const permission = info.role; // 'owner' | 'writer' | 'commenter' | 'reader'

      // Download the file
      const buffer = await downloadFile(file.id);
      const result = await importDashboardFromBuffer(buffer);

      // Import into app state
      dispatch({ type: 'IMPORT_STATE', payload: result });

      // Set drive file info
      dispatch({
        type: 'SET_DRIVE_FILE',
        payload: { id: file.id, name: file.name, permission },
      });

      // If viewer-only permission, ensure viewer mode
      if (permission === 'reader' || permission === 'commenter') {
        dispatch({ type: 'SET_MODE', payload: 'viewer' });
      }

      onClose();
    } catch (err) {
      setError('Failed to open file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const blob = await exportDashboardBlob(state.datasets, state.dashboard);

      if (state.driveFileId && (state.drivePermission === 'owner' || state.drivePermission === 'writer')) {
        // Update existing file
        const result = await updateFile(state.driveFileId, blob);
        dispatch({
          type: 'SET_DRIVE_FILE',
          payload: { id: result.id, name: result.name, permission: state.drivePermission },
        });
        setSuccessMsg(`Saved to "${result.name}"`);
      } else {
        // Create new file
        const name = saveName.trim() || 'My Dashboard';
        const result = await createFile(name, blob);
        const info = await getFileInfo(result.id);
        dispatch({
          type: 'SET_DRIVE_FILE',
          payload: { id: result.id, name: result.name, permission: info.role },
        });
        setSuccessMsg(`Created "${result.name}" on Drive`);
      }
    } catch (err) {
      setError('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAs = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const blob = await exportDashboardBlob(state.datasets, state.dashboard);
      const name = saveName.trim() || 'My Dashboard';
      const result = await createFile(name, blob);
      const info = await getFileInfo(result.id);
      dispatch({
        type: 'SET_DRIVE_FILE',
        payload: { id: result.id, name: result.name, permission: info.role },
      });
      setSuccessMsg(`Created "${result.name}" on Drive`);
    } catch (err) {
      setError('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isAvailable()) {
    return (
      <div className="drive-modal-overlay" onClick={onClose}>
        <div className="drive-modal" onClick={e => e.stopPropagation()}>
          <div className="drive-modal-header">
            <h3>Google Drive</h3>
            <button className="btn btn-icon" onClick={onClose}>&times;</button>
          </div>
          <div className="drive-modal-body" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Google Drive integration is not configured.<br />
              Set <code>REACT_APP_GOOGLE_CLIENT_ID</code> in your environment to enable it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="drive-modal-overlay" onClick={onClose}>
      <div className="drive-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="drive-modal-header">
          <h3>
            <svg width="20" height="20" viewBox="0 0 87.3 78" style={{ marginRight: 8, verticalAlign: -3 }}>
              <path d="M6.6 66.85L0 53.9 29.1 0h13.2z" fill="#0066DA"/>
              <path d="M58.1 78H29.1l14.9-25.85h29z" fill="#00AC47"/>
              <path d="M87.3 53.9L58.1 0H44.9l29.1 53.9z" fill="#EA4335"/>
              <path d="M29.1 78l14.9-25.85L29.1 26.3 14.9 52.15z" fill="#00832D"/>
              <path d="M44 52.15L58.1 78l29.2-24.1L73 27.85z" fill="#2684FC"/>
              <path d="M73 27.85L58.1 0H44.9L59 26.3z" fill="#FFBA00"/>
            </svg>
            Google Drive
          </h3>
          <button className="btn btn-icon" onClick={onClose}>&times;</button>
        </div>

        {/* Auth bar */}
        {!isSignedIn ? (
          <div className="drive-auth-bar">
            <span>Sign in to access your Drive files</span>
            <button className="btn btn-primary btn-sm" onClick={handleSignIn}>Sign in with Google</button>
          </div>
        ) : (
          <div className="drive-auth-bar">
            {state.driveUser && (
              <span className="drive-user-info">
                {state.driveUser.picture && (
                  <img src={state.driveUser.picture} alt="" className="drive-user-avatar" referrerPolicy="no-referrer" />
                )}
                {state.driveUser.name || state.driveUser.email}
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>Sign out</button>
          </div>
        )}

        {isSignedIn && (
          <>
            {/* Tab bar */}
            <div className="drive-tabs">
              <button
                className={`drive-tab ${tab === 'open' ? 'drive-tab--active' : ''}`}
                onClick={() => setTab('open')}
              >Open</button>
              <button
                className={`drive-tab ${tab === 'save' ? 'drive-tab--active' : ''}`}
                onClick={() => setTab('save')}
              >Save</button>
            </div>

            <div className="drive-modal-body">
              {error && <div className="drive-error">{error}</div>}
              {successMsg && <div className="drive-success">{successMsg}</div>}

              {tab === 'open' && (
                <>
                  <form className="drive-search" onSubmit={handleSearch}>
                    <input
                      type="text"
                      placeholder="Search .ytics files..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="drive-search-input"
                    />
                    <button type="submit" className="btn btn-secondary btn-sm">Search</button>
                  </form>

                  <div className="drive-file-list">
                    {loading ? (
                      <div className="drive-loading">Loading files...</div>
                    ) : files.length === 0 ? (
                      <div className="drive-empty">No .ytics files found</div>
                    ) : (
                      files.map(file => (
                        <div
                          key={file.id}
                          className="drive-file-item"
                          onClick={() => handleOpen(file)}
                        >
                          <div className="drive-file-icon">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M4 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.414a1 1 0 0 0-.293-.707L10.293 1.293A1 1 0 0 0 9.586 1H4z"/>
                            </svg>
                          </div>
                          <div className="drive-file-info">
                            <div className="drive-file-name">{file.name}</div>
                            <div className="drive-file-meta">
                              {file.modifiedTime && new Date(file.modifiedTime).toLocaleDateString()}
                              {file.owners?.[0]?.displayName && ` · ${file.owners[0].displayName}`}
                              {file.shared && ' · Shared'}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              {tab === 'save' && (
                <div className="drive-save-panel">
                  {state.driveFileId && (
                    <div className="drive-current-file">
                      Currently editing: <strong>{state.driveFileName}</strong>
                      <span className="drive-permission-badge">
                        {state.drivePermission === 'owner' ? 'Owner' :
                         state.drivePermission === 'writer' ? 'Editor' : 'Viewer'}
                      </span>
                    </div>
                  )}

                  <div className="drive-save-form">
                    <label className="drive-save-label">File name</label>
                    <input
                      type="text"
                      className="drive-save-input"
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      placeholder="Dashboard name..."
                    />
                  </div>

                  <div className="drive-save-actions">
                    {state.driveFileId && (state.drivePermission === 'owner' || state.drivePermission === 'writer') && (
                      <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : `Save to "${state.driveFileName}"`}
                      </button>
                    )}
                    <button
                      className="btn btn-secondary"
                      onClick={handleSaveAs}
                      disabled={saving || !saveName.trim()}
                    >
                      {saving ? 'Saving...' : 'Save as new file'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
