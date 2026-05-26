'use strict';

// ── Helpers ────────────────────────────────────────────────
function bgMsg(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (r) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(r || {});
    });
  });
}

function getVal(id)     { const el = document.getElementById(id); return el ? el.value : ''; }
function setVal(id, v)  { const el = document.getElementById(id); if (el) el.value = v; }
function on(id, ev, fn) { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); }
function esc(s)         { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function btnFlash(id, msg) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = msg; btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
}

function setStatus(elId, message, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = 'status-bar show ' + (type || '');
}

function updateAuthMode(url, devToken) {
  const box   = document.getElementById('authModeBox');
  const label = document.getElementById('authModeLabel');
  if (!box || !label) return;
  const isLocal = (url || '').includes('localhost') || (url || '').includes('127.0.0.1');
  if (devToken && devToken.trim()) {
    label.textContent = 'Bearer Token (CSRF bypassed ✓)';
    label.style.color = 'var(--green)';
    box.style.borderLeftColor = 'var(--green)';
    box.style.background      = '#f0fdf4';
    box.style.borderColor     = '#bbf7d0';
  } else if (isLocal) {
    label.textContent = 'Basic Auth — local (CSRF bypassed ✓)';
    label.style.color = 'var(--green)';
    box.style.borderLeftColor = 'var(--green)';
    box.style.background      = '#f0fdf4';
    box.style.borderColor     = '#bbf7d0';
  } else {
    label.textContent = 'Basic Auth — cloud (add Bearer token to bypass CSRF)';
    label.style.color = 'var(--amber)';
    box.style.borderLeftColor = 'var(--amber)';
    box.style.background      = '#fefce8';
    box.style.borderColor     = '#fde68a';
  }
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load saved config
  chrome.storage.local.get(['serverConfig'], (data) => {
    const sc = data.serverConfig || {};
    setVal('serverUrl',  sc.url      || '');
    setVal('serverUser', sc.user     || 'admin');
    setVal('serverPass', sc.pass     || '');
    setVal('devToken',   sc.devToken || '');
    updateAuthMode(sc.url || '', sc.devToken || '');
  });

  // Live auth mode update
  ['serverUrl', 'devToken'].forEach(id => {
    on(id, 'input', () => updateAuthMode(getVal('serverUrl'), getVal('devToken')));
  });

  on('saveConnBtn',  'click', saveConnection);
  on('testConnBtn',  'click', testConnection);
  on('savePathsBtn', 'click', savePaths);

  // Load detection paths
  chrome.storage.local.get(['detectionPaths'], (data) => {
    const dp = data.detectionPaths || {};
    setVal('oldAppsPath', dp.oldApps || '');
    setVal('newAppsPath', dp.newApps || '');
  });
});

// ── Save connection ────────────────────────────────────────
function saveConnection() {
  const url      = getVal('serverUrl').trim();
  const user     = getVal('serverUser').trim();
  const pass     = getVal('serverPass');
  const devToken = getVal('devToken').trim();
  if (!url) { setStatus('connStatus', 'Enter a server URL', 'err'); return; }
  chrome.storage.local.set({ serverConfig: { url, user, pass, devToken } }, () => {
    setStatus('connStatus', '✓ Connection saved', 'ok');
    updateAuthMode(url, devToken);
  });
}

// ── Test connection ────────────────────────────────────────
async function testConnection() {
  const url      = getVal('serverUrl').trim();
  const user     = getVal('serverUser').trim();
  const pass     = getVal('serverPass');
  const devToken = getVal('devToken').trim();
  if (!url) { setStatus('connStatus', 'Enter a server URL first', 'err'); return; }

  const btn = document.getElementById('testConnBtn');
  if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }
  setStatus('connStatus', 'Testing connection…', 'info');

  try {
    const result = await bgMsg('TEST_CONNECTION', { url, user, pass, devToken });
    if (result.ok) {
      setStatus('connStatus', '✓ Connected — ' + (result.version || url), 'ok');
    } else {
      setStatus('connStatus', '✗ ' + (result.error || 'Connection failed'), 'err');
    }
  } catch (e) {
    setStatus('connStatus', '✗ ' + e.message, 'err');
  } finally {
    if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; }
  }
}

function savePaths() {
  const dp = {
    oldApps: getVal('oldAppsPath').trim(),
    newApps: getVal('newAppsPath').trim(),
  };
  chrome.storage.local.set({ detectionPaths: dp }, () => {
    setStatus('pathsStatus', '✓ Paths saved', 'ok');
    setTimeout(() => {
      const el = document.getElementById('pathsStatus');
      if (el) el.className = 'status-bar';
    }, 2000);
  });
}
