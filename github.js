// github.js — GitHub REST API

const CONFIG_KEY = 'cricket_github_config';

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function githubHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

// Build URL for matches file (e.g. matches.json)
function buildUrl(config) {
  const { owner, repo, filepath } = config;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${filepath}`;
}

// Build URL for users file — same folder, always users.json
function buildUsersUrl(config) {
  const { owner, repo, filepath } = config;
  const dir = filepath.lastIndexOf('/') >= 0
    ? filepath.substring(0, filepath.lastIndexOf('/') + 1)
    : '';
  return `https://api.github.com/repos/${owner}/${repo}/contents/${dir}users.json`;
}

function toBase64(str) {
  return btoa(new TextEncoder().encode(str).reduce((s, b) => s + String.fromCharCode(b), ''));
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
    method: 'PUT',
    headers: githubHeaders(pat),
    body: JSON.stringify(body),
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

// ── Matches ──────────────────────────────────────────────────────────────────

async function fetchMatches(config) {
  const { missing, data } = await githubGet(buildUrl(config), config.pat);
  if (missing) return { matches: [], activeDraft: null, sha: null };

  let matches = [], activeDraft = null;
  try {
    const parsed = JSON.parse(atob(data.content.replace(/\n/g, '')));
    if (parsed && Array.isArray(parsed.matches)) matches     = parsed.matches;
    if (parsed && parsed.activeDraft)            activeDraft = parsed.activeDraft;
  } catch { /* ignore */ }
  return { matches, activeDraft, sha: data.sha };
}

async function pushMatches(config, matches, sha, activeDraft) {
  const payload = { version: 1, matches, activeDraft: activeDraft || null };
  const today   = new Date().toISOString().slice(0, 10);
  return githubPut(
    buildUrl(config), config.pat,
    `Update cricket scores ${today}`,
    toBase64(JSON.stringify(payload, null, 2)),
    sha
  );
}

// ── Users ────────────────────────────────────────────────────────────────────

async function fetchUsers(config) {
  const { missing, data } = await githubGet(buildUsersUrl(config), config.pat);
  if (missing) return { users: [], sha: null };

  let users = [];
  try {
    const parsed = JSON.parse(atob(data.content.replace(/\n/g, '')));
    if (parsed && Array.isArray(parsed.users)) users = parsed.users;
  } catch { /* ignore */ }
  return { users, sha: data.sha };
}

async function pushUsers(config, users, sha) {
  const payload = { version: 1, users };
  const today   = new Date().toISOString().slice(0, 10);
  return githubPut(
    buildUsersUrl(config), config.pat,
    `Update cricket users ${today}`,
    toBase64(JSON.stringify(payload, null, 2)),
    sha
  );
}
