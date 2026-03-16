// github.js — GitHub REST API (with Netlify proxy support)
// In proxy mode  : all calls go through /.netlify/functions/data — no PAT in browser.
// In direct mode : calls go straight to GitHub API using localStorage config.

const CONFIG_KEY = 'cricket_github_config';

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function toBase64(str) {
  return btoa(new TextEncoder().encode(str).reduce((s, b) => s + String.fromCharCode(b), ''));
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── Mode detection ────────────────────────────────────────────────────────────
// 'proxy-ok'           : Netlify function deployed AND env vars configured
// 'proxy-unconfigured' : Netlify function deployed but env vars missing
// 'direct'             : No Netlify function (local dev or not on Netlify)
let _mode = null;

async function detectMode() {
  if (_mode) return _mode;
  try {
    const res = await fetch('/.netlify/functions/data?probe=1', { method: 'GET' });
    _mode = res.status === 200 ? 'proxy-ok'
          : res.status === 503 ? 'proxy-unconfigured'
          : 'direct';
  } catch {
    _mode = 'direct';
  }
  return _mode;
}

// ── Proxy HTTP helpers ────────────────────────────────────────────────────────
async function proxyGet(file) {
  const res = await fetch(`/.netlify/functions/data?file=${file}`, { method: 'GET' });
  if (res.status === 404) return { missing: true };
  if (!res.ok) {
    let msg = `GitHub error ${res.status}`;
    try { const b = await res.json(); if (b && b.message) msg = b.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return { missing: false, data: await res.json() };
}

async function proxyPut(file, content, sha, message) {
  const body = { message, content };
  if (sha) body.sha = sha;
  const res = await fetch(`/.netlify/functions/data?file=${file}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (res.status === 409) throw new Error('CONFLICT');
  if (!res.ok) {
    let msg = `GitHub error ${res.status}`;
    try { const b = await res.json(); if (b && b.message) msg = b.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const data = await res.json();
  return data.content.sha;
}

// ── Direct GitHub HTTP helpers ────────────────────────────────────────────────
function githubHeaders(pat) {
  return {
    Authorization:          `Bearer ${pat}`,
    Accept:                 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':         'application/json',
  };
}

function buildUrl(config) {
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.filepath}`;
}

function buildUsersUrl(config) {
  const dir = config.filepath.lastIndexOf('/') >= 0
    ? config.filepath.substring(0, config.filepath.lastIndexOf('/') + 1)
    : '';
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${dir}users.json`;
}

async function githubGet(url, pat) {
  const res = await fetch(url, { method: 'GET', headers: githubHeaders(pat) });
  if (res.status === 404) return { missing: true };
  if (!res.ok) {
    let msg = `GitHub error ${res.status}`;
    try { const b = await res.json(); if (b && b.message) msg = b.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return { missing: false, data: await res.json() };
}

async function githubPut(url, pat, message, content, sha) {
  const body = { message, content };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method:  'PUT',
    headers: githubHeaders(pat),
    body:    JSON.stringify(body),
  });
  if (res.status === 409) throw new Error('CONFLICT');
  if (!res.ok) {
    let msg = `GitHub error ${res.status}`;
    try { const b = await res.json(); if (b && b.message) msg = b.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const data = await res.json();
  return data.content.sha;
}

// ── Matches ───────────────────────────────────────────────────────────────────
async function fetchMatches(config) {
  const mode = await detectMode();
  const { missing, data } = mode === 'proxy-ok'
    ? await proxyGet('matches')
    : await githubGet(buildUrl(config), config.pat);
  if (missing) return { matches: [], activeDraft: null, sha: null };
  let matches = [], activeDraft = null;
  try {
    const parsed = JSON.parse(fromBase64(data.content.replace(/\n/g, '')));
    if (parsed && Array.isArray(parsed.matches)) matches     = parsed.matches;
    if (parsed && parsed.activeDraft)            activeDraft = parsed.activeDraft;
  } catch { /* ignore */ }
  return { matches, activeDraft, sha: data.sha };
}

async function pushMatches(config, matches, sha, activeDraft) {
  const mode    = await detectMode();
  const payload = { version: 1, matches, activeDraft: activeDraft || null };
  const today   = new Date().toISOString().slice(0, 10);
  const message = `Update cricket scores ${today}`;
  const content = toBase64(JSON.stringify(payload, null, 2));
  if (mode === 'proxy-ok') return proxyPut('matches', content, sha, message);
  return githubPut(buildUrl(config), config.pat, message, content, sha);
}

// ── Users ─────────────────────────────────────────────────────────────────────
async function fetchUsers(config) {
  const mode = await detectMode();
  const { missing, data } = mode === 'proxy-ok'
    ? await proxyGet('users')
    : await githubGet(buildUsersUrl(config), config.pat);
  if (missing) return { users: [], sha: null };
  let users = [];
  try {
    const parsed = JSON.parse(fromBase64(data.content.replace(/\n/g, '')));
    if (parsed && Array.isArray(parsed.users)) users = parsed.users;
  } catch { /* ignore */ }
  return { users, sha: data.sha };
}

async function pushUsers(config, users, sha) {
  const mode    = await detectMode();
  const payload = { version: 1, users };
  const today   = new Date().toISOString().slice(0, 10);
  const message = `Update cricket users ${today}`;
  const content = toBase64(JSON.stringify(payload, null, 2));
  if (mode === 'proxy-ok') return proxyPut('users', content, sha, message);
  return githubPut(buildUsersUrl(config), config.pat, message, content, sha);
}
