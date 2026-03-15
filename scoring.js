// scoring.js — Pure cricket logic

function createMatch(team1Name, team2Name, maxOvers) {
  const now = new Date();
  return {
    id: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    status: 'in_progress',
    teams: [team1Name, team2Name],
    maxOvers: maxOvers || 20,
    innings: [
      createInnings(team1Name, team2Name),
      createInnings(team2Name, team1Name),
    ],
    currentInningsIndex: 0,
    result: null,
  };
}

function isOversComplete(match, inningsIndex) {
  const maxOvers = match.maxOvers || 20;
  return match.innings[inningsIndex].legalBalls >= maxOvers * 6;
}

function createInnings(battingTeam, bowlingTeam) {
  return {
    battingTeam,
    bowlingTeam,
    batters: [],
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
    wickets: 0,
    totalRuns: 0,
    legalBalls: 0,
    completed: false,
    strikerIndex: 0,
    nonStrikerIndex: 1,
    needNextBatter: false,
    currentOverBalls: [],
    lastOverBalls: [],
    bowlers: [],
    currentBowlerIndex: -1,
    needNextBowler: true,
  };
}

function addBowler(match, inningsIndex, name) {
  const innings = match.innings[inningsIndex];
  const existingIdx = innings.bowlers.findIndex(
    b => b.name.toLowerCase() === name.toLowerCase()
  );
  if (existingIdx >= 0) {
    innings.currentBowlerIndex = existingIdx;
  } else {
    innings.bowlers.push({ name, balls: 0, runs: 0, wickets: 0 });
    innings.currentBowlerIndex = innings.bowlers.length - 1;
  }
  innings.needNextBowler = false;
}

function needsBowler(match) {
  const innings = match.innings[match.currentInningsIndex];
  return innings.batters.length >= 2 && !innings.needNextBatter && innings.needNextBowler;
}

function addBatter(match, inningsIndex, name) {
  const innings = match.innings[inningsIndex];
  const newIndex = innings.batters.length;
  innings.batters.push({
    name,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    howOut: null,
    active: true,
  });
  if (innings.needNextBatter) {
    innings.strikerIndex = newIndex;
    innings.needNextBatter = false;
  }
}

function addBall(match, inningsIndex, event) {
  const innings = match.innings[inningsIndex];
  const striker = innings.batters[innings.strikerIndex];
  const prevLegalBalls = innings.legalBalls;

  switch (event) {
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '6': {
      const runs = parseInt(event, 10);
      striker.runs += runs;
      striker.balls += 1;
      if (runs === 4) striker.fours += 1;
      if (runs === 6) striker.sixes += 1;
      innings.totalRuns += runs;
      innings.legalBalls += 1;
      if (runs % 2 !== 0) {
        swapStrike(innings);
      }
      break;
    }
    case 'wide':
      innings.extras.wides += 1;
      innings.totalRuns += 1;
      break;
    case 'noball':
      innings.extras.noBalls += 1;
      innings.totalRuns += 1;
      break;
    case 'bye':
      innings.extras.byes += 1;
      innings.totalRuns += 1;
      innings.legalBalls += 1;
      striker.balls += 1;
      swapStrike(innings);
      break;
    case 'legbye':
      innings.extras.legByes += 1;
      innings.totalRuns += 1;
      innings.legalBalls += 1;
      striker.balls += 1;
      swapStrike(innings);
      break;
    case 'wicket':
      striker.howOut = 'out';
      striker.active = false;
      striker.balls += 1;
      innings.wickets += 1;
      innings.legalBalls += 1;
      innings.needNextBatter = true;
      break;
    default:
      break;
  }

  // Update current bowler stats
  const bowler = innings.currentBowlerIndex >= 0 ? innings.bowlers[innings.currentBowlerIndex] : null;
  if (bowler) {
    switch (event) {
      case 'wide':   bowler.runs += 1; break;                        // not a legal ball
      case 'noball': bowler.runs += 1; break;                        // not a legal ball
      case 'bye':    bowler.balls += 1; break;                       // legal ball, no runs charged
      case 'legbye': bowler.balls += 1; break;                       // legal ball, no runs charged
      case 'wicket': bowler.balls += 1; bowler.wickets += 1; break;
      default: { const r = parseInt(event, 10); if (!isNaN(r)) { bowler.balls += 1; bowler.runs += r; } }
    }
  }

  // End-of-over swap: whenever a legal ball completes an over, the bowling
  // switches ends, so the batter at the non-striker's end always faces next over.
  // This is applied after the run-based swap above, so the two interact correctly:
  //   odd runs  → run swap  + end-of-over swap = same batter faces next over
  //   even runs → no swap   + end-of-over swap = other batter faces next over
  if (innings.legalBalls % 6 === 0 && innings.legalBalls > prevLegalBalls) {
    swapStrike(innings);
    innings.needNextBowler = true;
  }

  // Ball-by-ball tracking for over display
  const ballDisplayMap = {
    '0': '\u00b7', '1': '1', '2': '2', '3': '3', '4': '4', '6': '6',
    'wide': 'Wd', 'noball': 'Nb', 'bye': 'B', 'legbye': 'Lb', 'wicket': 'W',
  };
  const ballRunMap = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '6': 6,
    'wide': 1, 'noball': 1, 'bye': 1, 'legbye': 1, 'wicket': 0,
  };
  innings.currentOverBalls.push({
    d: ballDisplayMap[event] || event,
    r: ballRunMap[event] !== undefined ? ballRunMap[event] : 0,
  });

  // Rotate over log when a legal ball completes an over
  if (innings.legalBalls % 6 === 0 && innings.legalBalls > prevLegalBalls) {
    innings.lastOverBalls = innings.currentOverBalls.slice();
    innings.currentOverBalls = [];
    // (end-of-over swap already applied above)
  }
}

function swapStrike(innings) {
  const tmp = innings.strikerIndex;
  innings.strikerIndex = innings.nonStrikerIndex;
  innings.nonStrikerIndex = tmp;
}

function swapStrikeManual(match, inningsIndex) {
  swapStrike(match.innings[inningsIndex]);
}

function completeInnings(match, inningsIndex) {
  match.innings[inningsIndex].completed = true;
}

function getOversString(legalBalls) {
  const overs = Math.floor(legalBalls / 6);
  const balls = legalBalls % 6;
  return `${overs}.${balls}`;
}

function trimToTen(matches) {
  if (matches.length > 10) {
    return matches.slice(matches.length - 10);
  }
  return matches;
}

function computeResult(match) {
  const inn0 = match.innings[0];
  const inn1 = match.innings[1];

  if (inn1.totalRuns > inn0.totalRuns) {
    const wicketsLeft = 10 - inn1.wickets;
    return `${inn1.battingTeam} won by ${wicketsLeft} wicket${wicketsLeft !== 1 ? 's' : ''}`;
  } else if (inn0.totalRuns > inn1.totalRuns) {
    const margin = inn0.totalRuns - inn1.totalRuns;
    return `${inn0.battingTeam} won by ${margin} run${margin !== 1 ? 's' : ''}`;
  } else {
    return 'Match tied';
  }
}

function isAllOut(match, inningsIndex) {
  return match.innings[inningsIndex].wickets >= 10;
}

function isTargetChased(match) {
  if (match.currentInningsIndex !== 1) return false;
  return match.innings[1].totalRuns > match.innings[0].totalRuns;
}

function needsBatter(match) {
  const innings = match.innings[match.currentInningsIndex];
  return innings.batters.length < 2 || innings.needNextBatter;
}

function canScore(match) {
  const innings = match.innings[match.currentInningsIndex];
  return innings.batters.length >= 2 && !innings.needNextBatter && !innings.needNextBowler;
}
