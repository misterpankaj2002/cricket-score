// netlify/functions/data.js
// Serverless proxy — keeps GITHUB_PAT on the server, never exposed to browsers.
// All devices automatically use the same GitHub connection.

exports.handler = async (event) => {
  const PAT      = process.env.GITHUB_PAT;
  const OWNER    = process.env.GITHUB_OWNER;
  const REPO     = process.env.GITHUB_REPO;
  const FILEPATH = process.env.GITHUB_FILEPATH || 'matches.json';

  // Probe endpoint: lets the client detect whether this function is reachable
  // and whether env vars are configured.
  if ((event.queryStringParameters || {}).probe === '1') {
    return {
      statusCode: PAT ? 200 : 503,
      headers: { 'Content-Type': 'text/plain' },
      body: PAT ? 'ok' : 'not-configured',
    };
  }

  if (!PAT || !OWNER || !REPO) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'SERVER_NOT_CONFIGURED' }),
    };
  }

  // Derive file path: ?file=users → users.json in same folder as matches file
  const file = (event.queryStringParameters || {}).file || 'matches';
  const dir  = FILEPATH.includes('/')
    ? FILEPATH.substring(0, FILEPATH.lastIndexOf('/') + 1)
    : '';
  const filepath = file === 'users' ? `${dir}users.json` : FILEPATH;

  const url     = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filepath}`;
  const headers = {
    Authorization:          `Bearer ${PAT}`,
    Accept:                 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':         'application/json',
  };

  try {
    let res;
    if (event.httpMethod === 'GET') {
      res = await fetch(url, { method: 'GET', headers });
    } else if (event.httpMethod === 'PUT') {
      res = await fetch(url, { method: 'PUT', headers, body: event.body });
    } else {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    const body = await res.text();
    return {
      statusCode: res.status,
      headers:    { 'Content-Type': 'application/json' },
      body,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers:    { 'Content-Type': 'application/json' },
      body:       JSON.stringify({ message: err.message }),
    };
  }
};
