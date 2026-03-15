// app.js

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  config:      null,
  matches:     [],
  sha:         null,
  activeMatch: null,
  undoStack:   [],
  currentUser: null,
};

// ── Auth ─────────────────────────────────────────────────────────────────────
const USERS_KEY   = 'cricket_users';
const SESSION_KEY = 'cricket_session';

async function hashPwd(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
  catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

async function attemptLogin(username, password) {
  let users = getUsers();
  // First run: seed default admin (username: admin, password: admin)
  if (!users.length) {
    users = [{ username: 'admin', hash: await hashPwd('admin'), role: 'admin' }];
    saveUsers(users);
  }
  const hash = await hashPwd(password);
  const user = users.find(
    u => u.username.toLowerCase() === username.toLowerCase() && u.hash === hash
  );
  if (!user) return false;
  state.currentUser = { username: user.username, role: user.role };
  localStorage.setItem(SESSION_KEY, JSON.stringify(state.currentUser));
  return true;
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) { state.currentUser = JSON.parse(raw); return true; }
  } catch {}
  return false;
}

function logout() {
  state.currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  showScreen('screen-login');
}

function updateHeaderUser() {
  const el = document.getElementById('header-user');
  if (state.currentUser) {
    el.textContent = state.currentUser.username;
    el.style.display = 'inline';
    document.getElementById('btn-logout').style.display = '';
  } else {
    el.textContent = '';
    el.style.display = 'none';
    document.getElementById('btn-logout').style.display = 'none';
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showLoading() { document.getElementById('loading-overlay').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading-overlay').style.display = 'none'; }

let _toastTimer = null;
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : type === 'warn' ? 'toast-warn' : '';
  el.style.display = 'block';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function saveActiveMatchLocally() {
  if (state.activeMatch) localStorage.setItem('cricket_active_match', JSON.stringify(state.activeMatch));
}

// ── Undo stack ───────────────────────────────────────────────────────────────
function pushUndo() {
  state.undoStack.push(JSON.stringify(state.activeMatch));
  if (state.undoStack.length > 30) state.undoStack.shift();
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = false;
}

function syncUndoButton() {
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = state.undoStack.length === 0;
}

// ── Screen transitions ──────────────────────────────────────────────────────
function showScreen(id) {
  ['screen-login', 'screen-home', 'screen-scoring', 'screen-result'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
  // Hide header chrome on login screen
  const onLogin = id === 'screen-login';
  document.getElementById('btn-open-settings').style.display = onLogin ? 'none' : '';
  updateHeaderUser();
  updateHeaderMatchName();
}

function updateHeaderMatchName() {
  const el = document.getElementById('match-event-label');
  const onScoring = document.getElementById('screen-scoring').style.display !== 'none';
  const name = onScoring && state.activeMatch && state.activeMatch.name;
  el.textContent = name || '';
  el.style.display = name ? 'block' : 'none';
}

// ── Settings modal ──────────────────────────────────────────────────────────
document.getElementById('btn-open-settings').addEventListener('click', openSettings);
document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSettings();
});

function openSettings() {
  const c = loadConfig();
  if (c) {
    document.getElementById('input-pat').value      = c.pat      || '';
    document.getElementById('input-owner').value    = c.owner    || '';
    document.getElementById('input-repo').value     = c.repo     || '';
    document.getElementById('input-filepath').value = c.filepath || 'matches.json';
  }
  document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

document.getElementById('form-settings').addEventListener('submit', async e => {
  e.preventDefault();
  const config = {
    pat:      document.getElementById('input-pat').value.trim(),
    owner:    document.getElementById('input-owner').value.trim(),
    repo:     document.getElementById('input-repo').value.trim(),
    filepath: document.getElementById('input-filepath').value.trim() || 'matches.json',
  };
  if (!config.pat || !config.owner || !config.repo) { setStatus('Please fill in all fields.', 'error'); return; }
  setStatus('Testing connection…', '');
  try {
    const result = await fetchMatches(config);
    saveConfig(config);
    state.config  = config;
    state.matches = result.matches;
    state.sha     = result.sha;
    if (result.sha === null) state.sha = await pushMatches(config, [], null);
    setStatus('Connected!', 'ok');
    renderPastMatches();
    setTimeout(closeSettings, 1000);
  } catch (err) { setStatus(err.message, 'error'); }
});

function setStatus(msg, type) {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className = 'status-msg show' + (type ? ' ' + type : '');
}

// ── Login / Logout ───────────────────────────────────────────────────────────
document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('input-login-user').value.trim();
  const password = document.getElementById('input-login-pass').value;
  const msg      = document.getElementById('login-msg');
  if (!username || !password) { showLoginMsg('Enter username and password.', 'error'); return; }
  msg.textContent = 'Signing in…';
  msg.className   = 'login-msg';
  const ok = await attemptLogin(username, password);
  if (ok) {
    document.getElementById('input-login-pass').value = '';
    msg.textContent = '';
    await startApp();
  } else {
    showLoginMsg('Incorrect username or password.', 'error');
  }
});

function showLoginMsg(text, type) {
  const el = document.getElementById('login-msg');
  el.textContent = text;
  el.className   = 'login-msg' + (type ? ' login-msg-' + type : '');
}

document.getElementById('btn-logout').addEventListener('click', () => {
  if (confirm('Sign out?')) logout();
});

// Change password (inside settings modal)
document.getElementById('btn-change-pwd').addEventListener('click', async () => {
  const currPwd = document.getElementById('input-curr-pwd').value;
  const newPwd  = document.getElementById('input-new-pwd').value.trim();
  if (!currPwd || !newPwd)    { setPwdStatus('Fill in both fields.', 'error'); return; }
  if (newPwd.length < 4)      { setPwdStatus('Password must be at least 4 characters.', 'error'); return; }
  const users    = getUsers();
  const currHash = await hashPwd(currPwd);
  const idx      = users.findIndex(
    u => u.username === state.currentUser.username && u.hash === currHash
  );
  if (idx < 0) { setPwdStatus('Current password is incorrect.', 'error'); return; }
  users[idx].hash = await hashPwd(newPwd);
  saveUsers(users);
  document.getElementById('input-curr-pwd').value = '';
  document.getElementById('input-new-pwd').value  = '';
  setPwdStatus('Password updated successfully.', 'ok');
});

function setPwdStatus(msg, type) {
  const el = document.getElementById('pwd-status');
  el.textContent = msg;
  el.className   = 'status-msg show' + (type ? ' ' + type : '');
}

// ── Past matches ────────────────────────────────────────────────────────────
function renderPastMatches() {
  populateMatchName();
  const container = document.getElementById('past-matches-list');
  const list = state.matches.slice().reverse();
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No matches yet.</div>';
    return;
  }
  container.innerHTML = '';
  list.forEach(m => {
    const card = document.createElement('div');
    card.className = 'match-card';
    const title = m.name || (m.teams[0] + ' vs ' + m.teams[1]);
    const scores = m.innings
      .filter(inn => inn.batters.length > 0 || inn.totalRuns > 0)
      .map(inn => `${esc(inn.battingTeam)}: ${inn.totalRuns}/${inn.wickets} (${getOversString(inn.legalBalls)})`)
      .join(' &middot; ');
    card.innerHTML =
      `<div class="match-card-teams">${esc(title)}</div>` +
      `<div class="match-card-scores">${esc(m.date)}${scores ? ' &middot; ' + scores : ''}</div>` +
      (m.result ? `<div class="match-card-result">${esc(m.result)}</div>` : '');
    card.addEventListener('click', () => showResult(m));
    container.appendChild(card);
  });
}

// ── Overs selector — populate 1–50, default 8 ───────────────────────────────
(function populateOversSelect() {
  const sel = document.getElementById('select-overs');
  for (let i = 1; i <= 50; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i === 1 ? '1 over' : `${i} overs`;
    if (i === 8) opt.selected = true;
    sel.appendChild(opt);
  }
})();

// ── Auto-populate match name ─────────────────────────────────────────────────
function populateMatchName() {
  const num  = state.matches.length + 1;
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('input-match-name').value = `Match ${num} \u2014 ${date}`;
}

// ── New match (inline on home screen) ───────────────────────────────────────
document.getElementById('btn-start-match').addEventListener('click', () => {
  const name     = document.getElementById('input-match-name').value.trim();
  const date     = new Date().toISOString().slice(0, 10);
  const maxOvers = parseInt(document.getElementById('select-overs').value, 10) || 8;

  state.activeMatch = createMatch('Team A', 'Team B', maxOvers);
  state.activeMatch.name = name || null;
  state.activeMatch.date = date;
  saveActiveMatchLocally();
  showScreen('screen-scoring');
  updateHeaderMatchName();
  renderScoring();
});

// Allow pressing Enter in the match name input to start the match
document.getElementById('input-match-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-start-match').click(); }
});

// ── Inline team-name editing during scoring ─────────────────────────────────
document.getElementById('inn-name-0').addEventListener('input', e => {
  if (!state.activeMatch) return;
  const name = e.target.value.trim() || 'Team A';
  state.activeMatch.teams[0] = name;
  state.activeMatch.innings[0].battingTeam = name;
  state.activeMatch.innings[1].bowlingTeam = name;
  saveActiveMatchLocally();
});
document.getElementById('inn-name-1').addEventListener('input', e => {
  if (!state.activeMatch) return;
  const name = e.target.value.trim() || 'Team B';
  state.activeMatch.teams[1] = name;
  state.activeMatch.innings[1].battingTeam = name;
  state.activeMatch.innings[0].bowlingTeam = name;
  saveActiveMatchLocally();
});

// ── Next suggested batter ───────────────────────────────────────────────────
function nextSuggestion() {
  return '';
}

// ── Render scoring screen ───────────────────────────────────────────────────
function renderScoring() {
  const match  = state.activeMatch;
  if (!match) return;
  const innIdx = match.currentInningsIndex;
  const inn    = match.innings[innIdx];
  syncUndoButton();

  // Innings bar
  match.innings.forEach((innings, i) => {
    const batting = i === innIdx;
    document.getElementById('inn-side-' + i).classList.toggle('batting', batting);
    // Only set name if input is not focused (avoid clobbering user typing)
    const nameInput = document.getElementById('inn-name-' + i);
    if (document.activeElement !== nameInput) nameInput.value = innings.battingTeam;
    const hasData = innings.batters.length > 0 || innings.totalRuns > 0;
    document.getElementById('inn-score-' + i).textContent = hasData ? innings.totalRuns + '/' + innings.wickets : '—';
    const maxOv = match.maxOvers || 20;
    document.getElementById('inn-overs-' + i).textContent =
      innings.legalBalls > 0
        ? '(' + getOversString(innings.legalBalls) + ' / ' + maxOv + ' ov)'
        : '(' + maxOv + ' ov)';
  });

  // Target bar
  const targetBar = document.getElementById('target-bar');
  if (innIdx === 1) {
    const target = match.innings[0].totalRuns + 1;
    const needed = target - inn.totalRuns;
    targetBar.textContent = needed > 0
      ? 'Target: ' + target + '  \u00b7  Need ' + needed + ' more run' + (needed !== 1 ? 's' : '')
      : 'Target reached!';
    targetBar.style.display = 'block';
  } else {
    targetBar.style.display = 'none';
  }

  // Batters
  const striker    = inn.batters[inn.strikerIndex];
  const nonStriker = inn.batters[inn.nonStrikerIndex];
  if (striker) {
    document.getElementById('striker-name').textContent  = striker.name;
    document.getElementById('striker-score').textContent = striker.runs + ' (' + striker.balls + ')';
  } else {
    document.getElementById('striker-name').textContent  = '—';
    document.getElementById('striker-score').textContent = '';
  }
  if (nonStriker) {
    document.getElementById('nonstriker-name').textContent  = nonStriker.name;
    document.getElementById('nonstriker-score').textContent = nonStriker.runs + ' (' + nonStriker.balls + ')';
  } else {
    document.getElementById('nonstriker-name').textContent  = '—';
    document.getElementById('nonstriker-score').textContent = '';
  }

  // Over info
  renderOverInfo(inn);

  // Inline add-batter row
  const needNow  = needsBatter(match);
  const addRow   = document.getElementById('add-batter-row');
  addRow.style.display = needNow ? 'flex' : 'none';
  if (needNow) {
    const count = inn.batters.length;
    document.getElementById('add-batter-label').textContent =
      count === 0 ? 'Opener 1' : count === 1 ? 'Opener 2' : 'Next Batter';
    const input = document.getElementById('input-next-batter');
    if (!input.value) input.value = nextSuggestion();
    setTimeout(() => input.focus(), 50);
  }

  // Inline add-bowler row
  const needBowlerNow = needsBowler(match);
  const bowlerRow = document.getElementById('add-bowler-row');
  bowlerRow.style.display = needBowlerNow ? 'block' : 'none';
  if (needBowlerNow) {
    renderBowlerSuggestions(inn);
    const bowlerInput = document.getElementById('input-next-bowler');
    if (!bowlerInput.value) setTimeout(() => bowlerInput.focus(), 50);
  }

  // Ball button states
  const ok = canScore(match);
  document.querySelectorAll('.ball-btn').forEach(btn => { btn.disabled = !ok; });

  // Scorecards
  renderScorecards();
}

// ── Over info rendering ─────────────────────────────────────────────────────
function chipClass(d) {
  if (d === '\u00b7') return 'chip-dot';
  if (d === '4')      return 'chip-four';
  if (d === '6')      return 'chip-six';
  if (d === 'W')      return 'chip-wicket';
  if (['Wd','Nb','B','Lb'].includes(d)) return 'chip-extra';
  return 'chip-runs';
}
function chipsHtml(balls) {
  return balls.map(b => `<span class="chip ${chipClass(b.d)}">${b.d}</span>`).join('');
}

function renderOverInfo(inn) {
  const completedOvers = Math.floor(inn.legalBalls / 6);
  const curOverNum     = completedOvers + 1;

  // Build current over segment
  let html = `<span class="over-label">Ov ${curOverNum}</span>`;
  if (inn.currentOverBalls.length > 0) {
    html += chipsHtml(inn.currentOverBalls);
  } else {
    html += `<span class="over-empty">—</span>`;
  }

  // Append previous over after a separator
  if (inn.lastOverBalls.length > 0) {
    const total = inn.lastOverBalls.reduce((s, b) => s + b.r, 0);
    html += `<span class="over-sep">|</span>`;
    html += `<span class="over-label">${total}r</span>`;
    html += chipsHtml(inn.lastOverBalls);
  }

  document.getElementById('over-current').innerHTML = html;
  document.getElementById('over-last').innerHTML = '';
}

// ── Scorecards ──────────────────────────────────────────────────────────────
function renderScorecards() {
  const match = state.activeMatch;
  if (!match) return;
  match.innings.forEach((inn, i) => renderOneCard(document.getElementById('scorecard-' + i), inn, i + 1));
}

function batterRow(b) {
  const cls    = b.howOut ? 'sc-row-out' : 'sc-row-active';
  const status = (!b.howOut && b.active) ? '*' : '';
  const sr     = b.balls > 0 ? (b.runs / b.balls * 100).toFixed(0) : '—';
  const fours  = b.fours || 0;
  const sixes  = b.sixes || 0;
  return `<tr class="${cls}">` +
    `<td class="td-name">${esc(b.name)}<span class="td-status-inline">${status}</span></td>` +
    `<td class="td-runs">${b.runs}</td>` +
    `<td class="td-balls">${b.balls}</td>` +
    `<td class="td-sr">${sr}</td>` +
    `<td class="td-fours">${fours}</td>` +
    `<td class="td-sixes">${sixes}</td>` +
    `</tr>`;
}

function renderOneCard(el, inn, num) {
  if (inn.batters.length === 0) {
    el.innerHTML = `<p class="sc-placeholder">Innings ${num} — not started</p>`; return;
  }
  const extTotal = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes;
  const rows = inn.batters.map(batterRow).join('');
  el.innerHTML =
    `<h4>${esc(inn.battingTeam)}</h4>` +
    `<table class="sc-table">` +
    `<thead><tr><th class="td-name">Batter</th><th class="td-runs">R</th><th class="td-balls">B</th><th class="td-sr">SR</th><th class="td-fours">4s</th><th class="td-sixes">6s</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<div class="sc-extras">WD ${inn.extras.wides} &middot; NB ${inn.extras.noBalls} &middot; B ${inn.extras.byes} &middot; LB ${inn.extras.legByes} = ${extTotal}</div>` +
    `<div class="sc-total">${inn.totalRuns}/${inn.wickets} (${getOversString(inn.legalBalls)} ov)</div>` +
    bowlingSection(inn);
}

function bowlingSection(inn) {
  if (!inn.bowlers || !inn.bowlers.length) return '';
  const rows = inn.bowlers.map(b =>
    `<tr>` +
    `<td class="td-name">${esc(b.name)}</td>` +
    `<td class="td-overs">${getOversString(b.balls)}</td>` +
    `<td class="td-bruns">${b.runs}</td>` +
    `<td class="td-wkts">${b.wickets}</td>` +
    `</tr>`
  ).join('');
  return `<div class="sc-section-label">Bowling</div>` +
    `<table class="sc-table">` +
    `<thead><tr><th class="td-name">Bowler</th><th class="td-overs">O</th><th class="td-bruns">R</th><th class="td-wkts">W</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
}

// ── Result screen ───────────────────────────────────────────────────────────
function showResult(match) {
  let html = '';
  if (match.result) html += `<div class="result-banner"><span class="result-banner-trophy">&#127942;</span><span class="result-banner-text">${esc(match.result)}</span></div>`;
  html += '<div class="scorecards-grid" style="border-top:none;margin-top:1px">';
  match.innings.forEach((inn, i) => {
    html += '<div class="scorecard-card">';
    if (inn.batters.length === 0) {
      html += `<p class="sc-placeholder">Innings ${i+1} — not started</p>`;
    } else {
      const extTotal = inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes;
      const rows = inn.batters.map(batterRow).join('');
      html +=
        `<h4>${esc(inn.battingTeam)}</h4>` +
        `<table class="sc-table">` +
        `<thead><tr><th class="td-name">Batter</th><th class="td-runs">R</th><th class="td-balls">B</th><th class="td-sr">SR</th><th class="td-fours">4s</th><th class="td-sixes">6s</th></tr></thead>` +
        `<tbody>${rows}</tbody></table>` +
        `<div class="sc-extras">WD ${inn.extras.wides} &middot; NB ${inn.extras.noBalls} &middot; B ${inn.extras.byes} &middot; LB ${inn.extras.legByes} = ${extTotal}</div>` +
        `<div class="sc-total">${inn.totalRuns}/${inn.wickets} (${getOversString(inn.legalBalls)} ov)</div>` +
        bowlingSection(inn);
    }
    html += '</div>';
  });
  html += '</div>';
  document.getElementById('result-content').innerHTML = html;
  showScreen('screen-result');
}

document.getElementById('btn-new-match').addEventListener('click', () => {
  showScreen('screen-home');
  renderPastMatches();
});

// ── Confirm batter ──────────────────────────────────────────────────────────
document.getElementById('btn-confirm-batter').addEventListener('click', confirmBatter);
document.getElementById('input-next-batter').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); confirmBatter(); }
});
function confirmBatter() {
  const input = document.getElementById('input-next-batter');
  const name  = input.value.trim();
  if (!name) return;
  const inn = state.activeMatch.innings[state.activeMatch.currentInningsIndex];
  if (inn.batters.some(b => b.name.toLowerCase() === name.toLowerCase())) {
    toast('Name already exists. Please enter a different name.', 'error');
    input.select();
    return;
  }
  pushUndo();
  addBatter(state.activeMatch, state.activeMatch.currentInningsIndex, name);
  input.value = '';
  saveActiveMatchLocally();
  renderScoring();
}

// ── Confirm bowler ──────────────────────────────────────────────────────────
document.getElementById('btn-confirm-bowler').addEventListener('click', confirmBowler);
document.getElementById('input-next-bowler').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); confirmBowler(); }
});

function confirmBowler() {
  const input = document.getElementById('input-next-bowler');
  const name  = input.value.trim();
  if (!name) return;
  pushUndo();
  addBowler(state.activeMatch, state.activeMatch.currentInningsIndex, name);
  input.value = '';
  saveActiveMatchLocally();
  renderScoring();
}

function renderBowlerSuggestions(inn) {
  const datalist = document.getElementById('bowler-datalist');
  datalist.innerHTML = inn.bowlers
    .map(b => `<option value="${esc(b.name)}">`)
    .join('');
}

// ── Ball events ─────────────────────────────────────────────────────────────
document.getElementById('ball-events').addEventListener('click', e => {
  const btn = e.target.closest('.ball-btn');
  if (!btn || btn.disabled || btn.id === 'btn-swap-strike') return;
  const event = btn.dataset.event;
  if (!event || !state.activeMatch) return;
  const innIdx = state.activeMatch.currentInningsIndex;
  pushUndo();
  addBall(state.activeMatch, innIdx, event);
  saveActiveMatchLocally();
  if (isAllOut(state.activeMatch, innIdx))         { handleInningsEnd(innIdx); return; }
  if (isOversComplete(state.activeMatch, innIdx))  { handleInningsEnd(innIdx); return; }
  if (isTargetChased(state.activeMatch))           { handleMatchEnd();         return; }
  renderScoring();
});

document.getElementById('btn-swap-strike').addEventListener('click', () => {
  if (!state.activeMatch) return;
  pushUndo();
  swapStrikeManual(state.activeMatch, state.activeMatch.currentInningsIndex);
  saveActiveMatchLocally();
  renderScoring();
});

document.getElementById('btn-undo').addEventListener('click', () => {
  if (!state.undoStack.length) return;
  state.activeMatch = JSON.parse(state.undoStack.pop());
  saveActiveMatchLocally();
  syncUndoButton();
  renderScoring();
});

// ── End innings ─────────────────────────────────────────────────────────────
document.getElementById('btn-end-innings').addEventListener('click', () => {
  if (!confirm('End this innings?')) return;
  if (!state.activeMatch) return;
  handleInningsEnd(state.activeMatch.currentInningsIndex);
});

function handleInningsEnd(innIdx) {
  const match = state.activeMatch;
  completeInnings(match, innIdx);
  state.undoStack = [];
  syncUndoButton();
  if (innIdx === 0) {
    match.currentInningsIndex = 1;
    saveActiveMatchLocally();
    renderScoring();
  } else {
    handleMatchEnd();
  }
}

async function handleMatchEnd() {
  const match = state.activeMatch;
  completeInnings(match, match.currentInningsIndex);
  match.status = 'completed';
  match.result = computeResult(match);
  localStorage.removeItem('cricket_active_match');
  await pushToGitHub(match);
  state.activeMatch = null;
  showResult(match);
}

// ── GitHub save ─────────────────────────────────────────────────────────────
async function pushToGitHub(match) {
  if (!state.config) { toast('No GitHub config — match not saved remotely.', 'warn'); return; }
  showLoading();
  const idx = state.matches.findIndex(m => m.id === match.id);
  if (idx >= 0) state.matches[idx] = match; else state.matches.push(match);
  state.matches = trimToTen(state.matches);
  try {
    state.sha = await pushMatches(state.config, state.matches, state.sha);
    toast('Saved to GitHub ✓', 'success');
  } catch (err) {
    if (err.message === 'CONFLICT') {
      try {
        const fresh = await fetchMatches(state.config);
        fresh.matches.push(match);
        const trimmed = trimToTen(fresh.matches);
        state.sha     = await pushMatches(state.config, trimmed, fresh.sha);
        state.matches = trimmed;
        toast('Saved to GitHub ✓', 'success');
      } catch (e2) { toast('Save failed: ' + e2.message, 'error'); }
    } else { toast('Save failed: ' + err.message, 'error'); }
  }
  hideLoading();
  renderPastMatches();
}

// ── App startup (called after successful login) ──────────────────────────────
async function startApp() {
  showScreen('screen-home');

  // Restore in-progress match
  try {
    const raw = localStorage.getItem('cricket_active_match');
    if (raw) state.activeMatch = JSON.parse(raw);
  } catch (_) { state.activeMatch = null; }

  // Load GitHub data
  const config = loadConfig();
  if (config) {
    state.config = config;
    showLoading();
    try {
      const result = await fetchMatches(config);
      state.matches = result.matches;
      state.sha     = result.sha;
    } catch (err) { toast('Could not load matches: ' + err.message, 'error'); }
    hideLoading();
  }

  renderPastMatches();

  // Resume prompt
  if (state.activeMatch) {
    const m = state.activeMatch;
    if (confirm('Resume match: ' + m.teams[0] + ' vs ' + m.teams[1] + '?')) {
      showScreen('screen-scoring');
      updateHeaderMatchName();
      renderScoring();
    } else {
      state.activeMatch = null;
      localStorage.removeItem('cricket_active_match');
    }
  }
}

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  if (restoreSession()) {
    await startApp();
    return;
  }
  // No session — show login; hint default credentials on first run
  showScreen('screen-login');
  if (!getUsers().length) {
    showLoginMsg('First time? Default login: admin / admin', 'info');
  }
  setTimeout(() => document.getElementById('input-login-user').focus(), 100);
}

init();
