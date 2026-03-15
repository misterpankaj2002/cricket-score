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

function buildUrl(config) {
  const { owner, repo, filepath } = config;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${filepath}`;
}

async function fetchMatches(config) {
  const url = buildUrl(config);
  const res = await fetch(url, {
    method: 'GET',
    headers: githubHeaders(config.pat),
  });

  if (res.status === 404) {
    return { matches: [], sha: null };
  }

  if (!res.ok) {
    let msg = `GitHub error ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.message) msg = body.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  const sha = data.sha;
  let matches = [];
  try {
    const decoded = atob(data.content.replace(/\n/g, ''));
    const parsed = JSON.parse(decoded);
    if (parsed && Array.isArray(parsed.matches)) {
      matches = parsed.matches;
    }
  } catch {
    matches = [];
  }
  return { matches, sha };
}

async function pushMatches(config, matches, sha) {
  const url = buildUrl(config);
  const today = new Date().toISOString().slice(0, 10);
  const payload = { version: 1, matches };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));

  const body = {
    message: `Update cricket scores ${today}`,
    content,
  };
  if (sha !== null) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: githubHeaders(config.pat),
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    throw new Error('CONFLICT');
  }

  if (!res.ok) {
    let msg = `GitHub error ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody && errBody.message) msg = errBody.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  return data.content.sha;
}
