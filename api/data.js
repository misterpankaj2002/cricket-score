// api/data.js — Vercel serverless function
// Proxy: keeps GITHUB_PAT on the server, never exposed to browsers.
// All devices auto-connect using the same GitHub credentials.

export default async function handler(req, res) {
  const PAT      = process.env.GITHUB_PAT;
  const OWNER    = process.env.GITHUB_OWNER;
  const REPO     = process.env.GITHUB_REPO;
  const FILEPATH = process.env.GITHUB_FILEPATH || 'matches.json';

  // Probe: lets the client detect whether this function is reachable
  // and whether env vars are configured.
  if (req.query.probe === '1') {
    return res.status(PAT ? 200 : 503).send(PAT ? 'ok' : 'not-configured');
  }

  if (!PAT || !OWNER || !REPO) {
    return res.status(503).json({ message: 'SERVER_NOT_CONFIGURED' });
  }

  // Derive file path: ?file=users → users.json in same folder as matches file
  const file     = req.query.file || 'matches';
  const dir      = FILEPATH.includes('/')
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
    let response;
    if (req.method === 'GET') {
      response = await fetch(url, { method: 'GET', headers });
    } else if (req.method === 'PUT') {
      // req.body is already parsed by Vercel; re-stringify for GitHub
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      response = await fetch(url, { method: 'PUT', headers, body });
    } else {
      return res.status(405).send('Method not allowed');
    }

    const text = await response.text();
    return res.status(response.status)
      .setHeader('Content-Type', 'application/json')
      .send(text);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
