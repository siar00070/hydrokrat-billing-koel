const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('../src/config');

function createSupabaseContext(userDataPath, safeStorage) {
  const sessionFile = path.join(userDataPath, 'hv-session.dat');

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
    // Electron's main process is plain Node with no browser WebSocket global;
    // the realtime client (unused by this app) needs one to construct without crashing.
    realtime: { transport: WebSocket }
  });

  function saveSession(session) {
    if (!session) {
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      return;
    }
    const payload = JSON.stringify({ refresh_token: session.refresh_token });
    const canEncrypt = safeStorage && safeStorage.isEncryptionAvailable();
    const data = canEncrypt ? safeStorage.encryptString(payload) : Buffer.from(payload, 'utf-8');
    fs.writeFileSync(sessionFile, data);
  }

  function loadPersistedRefreshToken() {
    if (!fs.existsSync(sessionFile)) return null;
    try {
      const raw = fs.readFileSync(sessionFile);
      const canDecrypt = safeStorage && safeStorage.isEncryptionAvailable();
      const payload = canDecrypt ? safeStorage.decryptString(raw) : raw.toString('utf-8');
      return JSON.parse(payload).refresh_token;
    } catch (e) {
      return null;
    }
  }

  let rememberSession = false;

  client.auth.onAuthStateChange((_event, session) => {
    if (rememberSession) saveSession(session);
  });

  async function restoreSession() {
    const refreshToken = loadPersistedRefreshToken();
    if (!refreshToken) return null;
    rememberSession = true; // a persisted token only exists if the user opted in last time
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error) {
      saveSession(null);
      rememberSession = false;
      return null;
    }
    return data.session;
  }

  async function login(email, password, remember) {
    rememberSession = !!remember;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    if (rememberSession) saveSession(data.session);
    return data.session;
  }

  async function logout() {
    await client.auth.signOut();
    rememberSession = false;
    saveSession(null);
  }

  async function getCurrentUser() {
    const { data } = await client.auth.getUser();
    return data.user || null;
  }

  return { client, login, logout, restoreSession, getCurrentUser };
}

module.exports = { createSupabaseContext };
