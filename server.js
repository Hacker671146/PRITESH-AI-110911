// ══════════════════════════════════════════════════════════════════════
// 🏆 APEX-Σ ULTIMATE ENGINE — v3.2 FULLY AUTOMATIC WINGO 1MIN
// Node.js port of api.py
// Auto result fetch + Auto prediction + Auto timer + Auto win/loss
// ══════════════════════════════════════════════════════════════════════

'use strict';

const readline = require('readline');

// ──────────────────────────────────────────────────────────────────────
// ⚙️ CONFIG
// ──────────────────────────────────────────────────────────────────────

const CONFIG = {
  period_seconds: 60,
  api_timeout: 10,
  demo_mode: true,
  api_url:
    'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
  poll_interval: 2,
};

// ──────────────────────────────────────────────────────────────────────
// SECTION 0: CORE UTILITIES
// ──────────────────────────────────────────────────────────────────────

function ingestHistory(history) {
  if (!Array.isArray(history)) return [];
  const nums = [];
  for (const h of history) {
    const val =
      h && typeof h === 'object' ? h.predictedNumber : h;
    if (val === null || val === undefined) continue;
    const n = parseInt(val, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 9) nums.push(n);
  }
  return nums;
}

function normalize(arr) {
  const s = arr.reduce((a, b) => a + b, 0);
  return s > 0 ? arr.map((v) => v / s) : new Array(arr.length).fill(0.1);
}

function weightedPick(probs) {
  const r = Math.random();
  let a = 0.0;
  for (let i = 0; i < probs.length; i++) {
    a += probs[i];
    if (r <= a) return i;
  }
  return probs.length - 1;
}

function confLevel(c) {
  return c >= 0.72 ? 'HIGH' : c >= 0.55 ? 'MEDIUM' : 'LOW';
}

function buildResult(num, conf, source, info) {
  return {
    number: String(num),
    size: num >= 5 ? 'BIG' : 'SMALL',
    confidence: confLevel(conf),
    confidencePercent: `${Math.round(conf * 100)}%`,
    source,
    modelInfo: info,
    _conf: conf,
  };
}

function buildFeatureStore(nums) {
  const N = nums.length;
  if (N === 0) return null;
  const freq = new Array(10).fill(0);
  for (const n of nums) freq[n] += 1;
  const lastSeen = new Array(10).fill(-1);
  for (let i = 0; i < N; i++) lastSeen[nums[i]] = i;
  const gaps = lastSeen.map((ls) => (ls === -1 ? N : N - 1 - ls));
  const last = nums[N - 1];
  let streak = 0;
  const ld = last >= 5 ? 'BIG' : 'SMALL';
  for (let i = N - 1; i >= 0; i--) {
    const d = nums[i] >= 5 ? 'BIG' : 'SMALL';
    if (d === ld) streak += 1;
    else break;
  }
  const mean = nums.reduce((a, b) => a + b, 0) / N;
  const variance = nums.reduce((a, n) => a + (n - mean) ** 2, 0) / N;
  return {
    nums,
    N,
    freq,
    gaps,
    last,
    streak,
    lastDir: ld,
    mean,
    variance,
    lastSeen,
  };
}

// ──────────────────────────────────────────────────────────────────────
// SECTION 1-4: ENGINES
// ──────────────────────────────────────────────────────────────────────

function patternLock(history) {
  const nums = ingestHistory(history);
  const N = nums.length;
  if (N < 10)
    return buildResult(randInt(0, 9), 0.42, 'PATTERN-LOCK', 'Low Data');

  const c = [];

  for (let p = 2; p <= 12; p++) {
    if (N < p * 3) continue;
    let m = 0;
    for (let i = p; i < N; i++) if (nums[i] === nums[i - p]) m++;
    const acc = m / (N - p);
    if (acc > 0.6)
      c.push({
        prediction: nums[N - p],
        confidence: acc,
        strength: acc * Math.log(p + 1),
        source: 'CYCLE',
      });
  }

  for (let L = 3; L <= 6; L++) {
    if (N < L * 2) continue;
    const cur = nums.slice(N - L).join(',');
    const matches = [];
    for (let i = 0; i < N - L; i++) {
      if (nums.slice(i, i + L).join(',') === cur) matches.push(nums[i + L]);
    }
    if (matches.length >= 2) {
      const counts = {};
      for (const m of matches) counts[m] = (counts[m] || 0) + 1;
      let best = [null, -1];
      for (const [k, v] of Object.entries(counts))
        if (v > best[1]) best = [parseInt(k, 10), v];
      const conf = best[1] / matches.length;
      if (conf >= 0.6)
        c.push({
          prediction: best[0],
          confidence: conf,
          strength: conf * Math.log(matches.length + 1) * 1.2,
          source: 'SEQUENCE',
        });
    }
  }

  if (N >= 5) {
    const last2 = nums.slice(N - 2).join(',');
    const fu = [];
    for (let i = 0; i < N - 2; i++) {
      if (nums.slice(i, i + 2).join(',') === last2) fu.push(nums[i + 2]);
    }
    if (fu.length >= 2) {
      const counts = {};
      for (const f of fu) counts[f] = (counts[f] || 0) + 1;
      let best = [null, -1];
      for (const [k, v] of Object.entries(counts))
        if (v > best[1]) best = [parseInt(k, 10), v];
      const conf = best[1] / fu.length;
      if (conf >= 0.6)
        c.push({
          prediction: best[0],
          confidence: conf,
          strength: conf * Math.log(fu.length + 1),
          source: 'TRANSITION',
        });
    }
  }

  const fs = buildFeatureStore(nums);
  if (fs.streak >= 5) {
    const opp = fs.lastDir === 'BIG' ? 'SMALL' : 'BIG';
    const rng = opp === 'BIG' ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
    const oc = {};
    for (const n of rng) oc[n] = 0;
    for (const n of nums) if (n in oc) oc[n] += 1;
    let best = [null, -1];
    for (const [k, v] of Object.entries(oc))
      if (v > best[1]) best = [parseInt(k, 10), v];
    c.push({
      prediction: best[0],
      confidence: Math.min(0.85, 0.6 + (fs.streak - 5) * 0.05),
      strength: 1.5 + (fs.streak - 5) * 0.3,
      source: 'STREAK',
    });
  }

  if (c.length === 0)
    return buildResult(randInt(0, 9), 0.42, 'PATTERN-LOCK', 'No Pattern');

  c.sort((a, b) => b.strength - a.strength);
  const t1 = c[0];
  const t2 = c.length > 1 ? c[1] : null;
  if (t2 && t1.prediction === t2.prediction)
    return buildResult(
      t1.prediction,
      0.88,
      'PATTERN-LOCK',
      `✅ ${t1.source}+${t2.source} agree`
    );
  return buildResult(
    t1.prediction,
    Math.min(0.8, 0.55 + t1.confidence * 0.3),
    'PATTERN-LOCK',
    `${t1.source} (${t1.confidence.toFixed(2)})`
  );
}

function karmaCycle(history, fs) {
  const { nums, N, lastSeen: ls } = fs;
  if (N < 10)
    return buildResult(randInt(0, 9), 0.42, 'KARMA-CYCLE', 'Low Data');

  const probs = new Array(10).fill(0.1);
  for (let n = 0; n < 10; n++) {
    if (ls[n] === -1) {
      probs[n] = 2.0;
      continue;
    }
    const gap = N - 1 - ls[n];
    const pos = [];
    for (let i = 0; i < N; i++) if (nums[i] === n) pos.push(i);
    if (pos.length >= 3) {
      const gaps = [];
      for (let i = 1; i < pos.length; i++) gaps.push(pos[i] - pos[i - 1]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const r = gap / avg;
      probs[n] =
        r > 1.2 ? 1.5 + (r - 1.2) * 2 : r > 0.8 ? 1.2 : 0.5 / (r + 0.5);
    }
  }
  const norm = normalize(probs);
  return buildResult(
    weightedPick(norm),
    Math.min(0.85, 0.5 + Math.min(0.3, Math.max(...norm) * 0.5)),
    'KARMA-CYCLE',
    'Cyclic'
  );
}

function ecosystem(history) {
  const nums = ingestHistory(history);
  const N = nums.length;
  if (N < 12)
    return buildResult(randInt(0, 9), 0.42, 'ECOSYSTEM', 'Low Data');

  const w = Math.min(15, N);
  const pop = new Array(10).fill(0);
  for (const n of nums.slice(-w)) pop[n] += 1;
  const cap = w / 10;
  let cur = [...pop];

  for (let iter = 0; iter < 20; iter++) {
    const next = [...cur];
    for (let i = 0; i < 10; i++) {
      const g = 0.3 * cur[i] * (1 - cur[i] / cap);
      let comp = 0;
      for (let j = 0; j < 10; j++) {
        if (i !== j && cur[j] > cap * 1.5) comp += cur[j] * 0.05;
      }
      next[i] = Math.max(0, cur[i] + g - comp);
    }
    cur = next;
  }

  const d = cur.map((v, i) => v - pop[i]);
  const probs = [];
  for (let i = 0; i < 10; i++)
    probs.push(Math.exp(cur[i] * 0.5) * Math.exp(d[i] * 0.8));
  const norm = normalize(probs);
  const pick = weightedPick(norm);
  return buildResult(
    pick,
    Math.min(0.85, 0.42 + Math.min(0.4, Math.max(...d) * 0.15 + Math.max(...norm) * 0.3)),
    'ECOSYSTEM',
    `Δ:${d[pick].toFixed(2)}`
  );
}

function temporalLoom(history) {
  const nums = ingestHistory(history);
  const N = nums.length;
  if (N < 15)
    return buildResult(randInt(0, 9), 0.42, 'TEMPORAL-LOOM', 'Low Data');

  const threads = [];
  for (let L = 2; L <= 4; L++) {
    const pm = new Map();
    for (let i = 0; i < N - L + 1; i++) {
      const key = nums.slice(i, i + L).join(',');
      if (!pm.has(key)) pm.set(key, []);
      pm.get(key).push(i);
    }
    const curKey = nums.slice(N - L).join(',');
    for (const [pat, pos] of pm.entries()) {
      if (pos.length < 2 || pat !== curKey) continue;
      const age = N - pos[pos.length - 1];
      const fu = [];
      for (let i = 0; i < pos.length - 1; i++) {
        const p = pos[i];
        if (p + L < N) fu.push(nums[p + L]);
      }
      if (fu.length > 0)
        threads.push({
          strength: pos.length / (1 + age * 0.1),
          followUps: fu,
        });
    }
  }

  if (threads.length === 0)
    return buildResult(randInt(0, 9), 0.45, 'TEMPORAL-LOOM', 'No Threads');

  const votes = new Array(10).fill(0);
  for (const t of threads) for (const f of t.followUps) votes[f] += t.strength;
  const norm = normalize(votes);
  return buildResult(
    weightedPick(norm),
    Math.min(0.88, 0.45 + Math.max(...norm) * 0.4),
    'TEMPORAL-LOOM',
    `Threads:${threads.length}`
  );
}

function chronosSupreme(history, fs) {
  const { nums, N } = fs;
  if (N < 5)
    return buildResult(randInt(0, 9), 0.4, 'CHRONOS', 'Low Data');

  const votes = new Array(10).fill(0);
  const picks = [];

  for (const [w, wt] of [
    [5, 1.0],
    [Math.min(20, N), 1.5],
    [Math.min(100, N), 2.0],
  ]) {
    if (w < 3) continue;
    const sl = nums.slice(-w);
    const freq = new Array(10).fill(0);
    for (const n of sl) freq[n] += 1;
    const lm = sl.reduce((a, b) => a + b, 0) / sl.length;
    const probs = [];
    for (let i = 0; i < 10; i++)
      probs.push(
        ((freq[i] + 1) / (sl.length + 10)) * 0.6 +
          Math.exp(-Math.abs(i - lm) / 3) * 0.4
      );
    const norm = normalize(probs);
    picks.push(weightedPick(norm));
    const dm = Math.min(2, w / N + 0.5);
    for (let i = 0; i < 10; i++) votes[i] += norm[i] * wt * dm;
  }

  const dis = new Set(picks).size / picks.length;
  const norm = normalize(votes);
  return buildResult(
    weightedPick(norm),
    Math.min(0.85, 0.55 * (1 - dis * 0.5) + Math.max(...norm) * 0.3),
    'CHRONOS-SUPREME',
    `Horizons:${picks.join('/')}`
  );
}

function stellarRF(history, fs) {
  const { nums, N, freq, gaps, streak, lastDir: ld } = fs;
  if (N < 15)
    return buildResult(randInt(0, 9), 0.4, 'STELLAR-RF', 'Low Data');

  const votes = new Array(10).fill(0);
  for (let t = 0; t < 20; t++) {
    for (let n = 0; n < 10; n++) {
      let sc = (freq[n] / N) * 0.4 + (gaps[n] / N) * 0.3;
      if (streak >= 3) {
        if (ld === 'BIG' && n < 5) sc += 0.25;
        if (ld === 'SMALL' && n >= 5) sc += 0.25;
      }
      if (sc > 0.3 + Math.random() * 0.2) votes[n] += 0.5 + Math.random();
    }
  }
  const norm = normalize(votes.map((v) => v + 0.05));
  return buildResult(
    weightedPick(norm),
    Math.max(0.42, Math.min(0.85, Math.max(...norm) * 2.3)),
    'STELLAR-RF',
    '20 trees'
  );
}

const _HD = { vectors: null, DIM: 5000 };

function _initHd() {
  if (_HD.vectors === null) {
    _HD.vectors = [];
    for (let n = 0; n < 10; n++) {
      const v = [];
      for (let i = 0; i < _HD.DIM; i++) v.push(Math.random() < 0.5 ? 1 : -1);
      _HD.vectors.push(v);
    }
  }
}

function hyperdimension(history) {
  _initHd();
  const nums = ingestHistory(history);
  const N = nums.length;
  if (N < 8)
    return buildResult(randInt(0, 9), 0.42, 'HYPERDIM', 'Low Data');

  const V = _HD.vectors;
  const w = nums.slice(-12);
  const hvSum = new Array(_HD.DIM).fill(0);
  for (let i = 0; i < w.length - 1; i++) {
    for (let k = 0; k < _HD.DIM; k++)
      hvSum[k] += V[w[i]][k] * V[w[i + 1]][k];
  }
  const hv = hvSum.map((s) => (s >= 0 ? 1 : -1));
  const lv = V[nums[N - 1]];

  const sims = [];
  for (let n = 0; n < 10; n++) {
    let match = 0;
    for (let k = 0; k < _HD.DIM; k++)
      if (lv[k] * V[n][k] === hv[k]) match++;
    sims.push(match / _HD.DIM);
  }
  const norm = normalize(sims.map((s) => Math.exp(s * 15)));
  return buildResult(
    weightedPick(norm),
    Math.min(0.85, 0.42 + Math.max(...norm) * 0.45),
    'HYPERDIM',
    `Dim:${_HD.DIM}`
  );
}

function omegaCortex(history) {
  const nums = ingestHistory(history);
  const N = nums.length;
  if (N < 8)
    return buildResult(randInt(0, 9), 0.42, 'OMEGA-CORTEX', 'Low Data');

  const last = nums[N - 1];
  const w = nums.slice(-16);
  const attn = w.map(
    (n, i) => Math.exp(-Math.abs(n - last) / 2) * ((i + 1) / w.length)
  );
  const s = attn.reduce((a, b) => a + b, 0) || 1;
  const an = attn.map((a) => a / s);

  const probs = new Array(10).fill(0.01);
  const st = N - w.length;
  for (let i = 0; i < an.length; i++) {
    if (st + i + 1 < N) probs[nums[st + i + 1]] += an[i] * 2;
  }
  const norm = normalize(probs);
  return buildResult(
    weightedPick(norm),
    Math.min(0.85, 0.45 + Math.max(...norm) * 0.4),
    'OMEGA-CORTEX',
    'Attn'
  );
}

function ensembleAgreement(history) {
  const nums = ingestHistory(history);
  if (nums.length < 10)
    return buildResult(randInt(0, 9), 0.42, 'ENSEMBLE', 'Low Data');

  const fs = buildFeatureStore(nums);
  const engines = [
    ['PATTERN-LOCK', () => patternLock(history), 2.5],
    ['TEMPORAL-LOOM', () => temporalLoom(history), 2.2],
    ['ECOSYSTEM', () => ecosystem(history), 2.0],
    ['KARMA-CYCLE', () => karmaCycle(history, fs), 2.0],
    ['CHRONOS', () => chronosSupreme(history, fs), 1.8],
    ['OMEGA-CORTEX', () => omegaCortex(history), 2.0],
    ['STELLAR-RF', () => stellarRF(history, fs), 1.8],
    ['HYPERDIM', () => hyperdimension(history), 1.6],
  ];

  const res = [];
  for (const [name, fn, wt] of engines) {
    try {
      const r = fn();
      if (r && r.number !== undefined && r.number !== null)
        res.push({
          name,
          number: parseInt(r.number, 10),
          confidence: r._conf ?? 0.5,
          weight: wt,
        });
    } catch (e) {
      /* ignore */
    }
  }

  if (res.length === 0)
    return buildResult(randInt(0, 9), 0.42, 'ENSEMBLE', 'All Failed');

  const vm = new Map();
  for (const r of res) {
    if (!vm.has(r.number)) vm.set(r.number, { count: 0, weight: 0 });
    const e = vm.get(r.number);
    e.count += 1;
    e.weight += r.weight * r.confidence;
  }
  const srt = [...vm.entries()]
    .map(([num, d]) => ({ num, ...d }))
    .sort((a, b) => b.count - a.count || b.weight - a.weight);
  const win = srt[0];
  const ratio = win.count / res.length;

  let conf = 0.42;
  let strength = 'WEAK';
  if (ratio >= 0.75) [conf, strength] = [0.9, 'SUPER'];
  else if (ratio >= 0.625) [conf, strength] = [0.82, 'STRONG'];
  else if (ratio >= 0.5) [conf, strength] = [0.72, 'GOOD'];
  else if (ratio >= 0.375) [conf, strength] = [0.6, 'MODERATE'];

  return buildResult(
    win.num,
    conf,
    'ENSEMBLE-AGREE',
    `${win.count}/${res.length} · ${strength}`
  );
}

function tripleConfirm(history) {
  const nums = ingestHistory(history);
  if (nums.length < 15)
    return buildResult(randInt(0, 9), 0.42, 'TRIPLE-CONFIRM', 'Low Data');

  const lk = patternLock(history);
  const en = ensembleAgreement(history);
  const ln = parseInt(lk.number, 10);
  const lc = lk._conf ?? 0.5;
  const enn = parseInt(en.number, 10);
  const ec = en._conf ?? 0.5;

  if (ln === enn) {
    const avg = (lc + ec) / 2;
    return buildResult(
      ln,
      Math.min(0.92, 0.7 + avg * 0.2),
      'TRIPLE-CONFIRM',
      `💎 LOCK+ENSEMBLE agree · avg:${Math.round(avg * 100)}%`
    );
  }
  if (lc > ec)
    return buildResult(ln, lc * 0.85, 'TRIPLE-CONFIRM', 'LOCK wins');
  return buildResult(enn, ec * 0.85, 'TRIPLE-CONFIRM', 'ENSEMBLE wins');
}

// ──────────────────────────────────────────────────────────────────────
// SECTION 5: APEX-Σ ORCHESTRATOR
// ──────────────────────────────────────────────────────────────────────

const apexState = {
  predictions: [],
  accuracy: { correct: 0, total: 0 },
  streak: { current: 0, best: 0 },
  win_loss: { wins: 0, losses: 0, history: [] },
};

function apexSigma(history) {
  const nums = ingestHistory(history);
  if (nums.length === 0)
    return buildResult(randInt(0, 9), 0.35, 'APEX-Σ', 'No History');
  if (nums.length < 10) return patternLock(history);

  const lk = patternLock(history);
  const en = ensembleAgreement(history);
  const tr = tripleConfirm(history);

  const ln = parseInt(lk.number, 10);
  const lc = lk._conf ?? 0.5;
  const enn = parseInt(en.number, 10);
  const ec = en._conf ?? 0.5;
  const tn = parseInt(tr.number, 10);
  const tc = tr._conf ?? 0.5;

  if (tc >= 0.85 && (tr.modelInfo || '').includes('💎'))
    return {
      ...tr,
      source: 'APEX-Σ',
      modelInfo: `🎯 ULTIMATE: ${tr.modelInfo}`,
    };

  if (ln === enn) {
    const avg = (lc + ec) / 2;
    return buildResult(
      ln,
      Math.min(0.92, 0.7 + avg * 0.2),
      'APEX-Σ',
      `✅ LOCK+ENSEMBLE agree (${avg.toFixed(2)})`
    );
  }

  if (lc >= 0.85)
    return {
      ...lk,
      source: 'APEX-Σ',
      modelInfo: `🔒 LOCK: ${lk.modelInfo}`,
    };

  if (ec >= 0.85)
    return {
      ...en,
      source: 'APEX-Σ',
      modelInfo: `🤖 ENS: ${en.modelInfo}`,
    };

  const votes = new Array(10).fill(0);
  votes[ln] += lc * 2.5;
  votes[enn] += ec * 2.2;
  votes[tn] += tc * 2.8;
  const norm = normalize(votes);
  return buildResult(
    weightedPick(norm),
    Math.max(0.55, Math.min(0.8, Math.max(...norm) * 1.5)),
    'APEX-Σ',
    `Vote: LOCK=${ln} ENS=${enn} TRI=${tn}`
  );
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: 🎰 AUTO RESULT FETCHER
// ══════════════════════════════════════════════════════════════════════

class WingoAPI {
  constructor(demoMode = true, apiUrl = null) {
    this.demoMode = demoMode;
    this.apiUrl = apiUrl || CONFIG.api_url;
  }

  async _fetchReal() {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), CONFIG.api_timeout * 1000);
      const resp = await fetch(this.apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal,
      });
      clearTimeout(t);
      const data = await resp.json();
      const items = data?.data?.list || [];
      const out = [];
      for (const it of items) {
        const period = String(it.issueNumber ?? '');
        const number = parseInt(it.number, 10);
        if (Number.isInteger(number)) out.push({ period, number });
      }
      return out;
    } catch (e) {
      console.log(`  ⚠️ API error: ${e.message}`);
      return [];
    }
  }

  _fetchDemo() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const period = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
      now.getDate()
    )}${pad(now.getHours())}${pad(now.getMinutes())}`;
    const idx = (now.getMinutes() + now.getHours() * 60) % 10;
    const noise = [0, 0, 0, 1, -1][Math.floor(Math.random() * 5)];
    const num = Math.max(0, Math.min(9, idx + noise));
    return [{ period, number: num }];
  }

  async fetch() {
    return this.demoMode ? this._fetchDemo() : this._fetchReal();
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: 🎰 FULLY AUTOMATIC WINGO ENGINE
// ══════════════════════════════════════════════════════════════════════

class WingoAuto {
  constructor(demoMode = true) {
    this.api = new WingoAPI(demoMode);
    this.history = [];
    this.seenPeriods = new Set();
    this.currentPrediction = null;
    this.currentPeriod = null;
    this.running = false;
    this._stop = false;
    this.maxRounds = 0;
  }

  async fetchNewResults() {
    const items = await this.api.fetch();
    const added = [];
    for (const it of items) {
      const p = it.period;
      if (!this.seenPeriods.has(p) && p !== this.currentPeriod) {
        this.seenPeriods.add(p);
        this.history.push({
          predictedNumber: String(it.number),
          period: p,
          time: fmtTime(new Date()),
        });
        added.push(it);
      }
    }
    return added;
  }

  static secondsLeft() {
    return 60 - new Date().getSeconds();
  }

  static printTimer(secs, period) {
    const barLen = 30;
    const filled = Math.floor((barLen * secs) / 60);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    process.stdout.write(
      `\r  ⏱️  [${period}] Next in ${String(secs).padStart(2, ' ')}s  [${bar}]`
    );
    if (secs === 0) process.stdout.write('\n');
  }

  printStats() {
    const wl = apexState.win_loss;
    const total = wl.wins + wl.losses;
    const wr = total > 0 ? (wl.wins / total) * 100 : 0;
    const acc = apexState.accuracy;
    const ar = acc.total > 0 ? (acc.correct / acc.total) * 100 : 0;

    console.log('\n' + '═'.repeat(60));
    console.log('📊 AUTO WINGO STATS');
    console.log('═'.repeat(60));
    console.log(`  History Size   : ${this.history.length}`);
    console.log(`  Total Rounds   : ${total}`);
    console.log(`  ✅ Wins        : ${wl.wins}`);
    console.log(`  ❌ Losses      : ${wl.losses}`);
    console.log(`  🎯 Win Rate    : ${wr.toFixed(1)}%`);
    console.log(`  📈 Accuracy    : ${ar.toFixed(1)}%`);
    console.log(`  🔥 Best Streak : ${apexState.streak.best}`);
    console.log('═'.repeat(60));

    if (wl.history.length > 0) {
      console.log('\n📜 Last 10 Results:');
      console.log(
        `  ${'#'.padEnd(4)}${'Period'.padEnd(15)}${'Pred'.padEnd(6)}${'Actual'.padEnd(8)}${'Result'.padEnd(12)}${'Conf'.padEnd(10)}`
      );
      console.log('  ' + '-'.repeat(60));
      const last = wl.history.slice(-10);
      last.forEach((h, i) => {
        const icon = h.result === 'WIN' ? '✅ WIN ' : '❌ LOSS';
        console.log(
          `  ${String(i + 1).padEnd(4)}${String(h.period).padEnd(15)}${String(
            h.predicted
          ).padEnd(6)}${String(h.actual).padEnd(8)}${icon.padEnd(12)}${String(
            h.confidence ?? '-'
          ).padEnd(10)}`
        );
      });
    }
    console.log();
  }

  resolvePrediction(actualNum, actualPeriod) {
    if (!this.currentPrediction || !this.currentPeriod) return null;
    const predicted = parseInt(this.currentPrediction.number, 10);
    const correct = predicted === actualNum;

    apexState.accuracy.total += 1;
    if (correct) {
      apexState.accuracy.correct += 1;
      apexState.streak.current += 1;
      apexState.streak.best = Math.max(
        apexState.streak.best,
        apexState.streak.current
      );
      apexState.win_loss.wins += 1;
    } else {
      apexState.streak.current = 0;
      apexState.win_loss.losses += 1;
    }

    apexState.win_loss.history.push({
      period: actualPeriod,
      predicted,
      actual: actualNum,
      result: correct ? 'WIN' : 'LOSS',
      confidence: this.currentPrediction.confidence,
      time: fmtTime(new Date()),
    });

    return correct;
  }

  makePrediction() {
    const pred = apexSigma(this.history);
    const now = new Date();
    const next = new Date(now.getTime());
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);
    pred.period = fmtPeriod(next);
    pred.timestamp = fmtTime(now);
    this.currentPrediction = pred;
    this.currentPeriod = pred.period;
    return pred;
  }

  printPrediction(pred) {
    const icon = { HIGH: '🔥', MEDIUM: '⚡', LOW: '💧' }[pred.confidence];
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🕐 PREDICTION FOR PERIOD: ${pred.period}`);
    console.log('─'.repeat(60));
    console.log(`  🎯 NUMBER     : ${pred.number}  (${pred.size})`);
    console.log(
      `  📊 CONFIDENCE : ${icon} ${pred.confidence} (${pred.confidencePercent})`
    );
    console.log(`  🔍 SOURCE     : ${pred.source}`);
    console.log(`  💡 INFO       : ${pred.modelInfo}`);
    console.log('─'.repeat(60));
  }

  async runAuto(maxRounds = 0) {
    this.running = true;
    this._stop = false;
    this.maxRounds = maxRounds;
    let roundsDone = 0;

    console.log('\n' + '🎰'.repeat(20));
    console.log('  AUTO WINGO 1MIN — FULLY AUTOMATIC MODE');
    console.log('🎰'.repeat(20));
    console.log(
      `  Mode: ${this.api.demoMode ? 'DEMO (fake API)' : 'LIVE (real API)'}`
    );
    console.log(`  Rounds: ${maxRounds === 0 ? '∞ (infinite)' : maxRounds}`);
    console.log('  (Ctrl+C se stop karo)\n');

    console.log('  📥 Seeding history from API...');
    const initial = await this.fetchNewResults();
    console.log(`  ✅ Loaded ${initial.length} initial results\n`);

    const stopHandler = () => {
      console.log('\n  ⛔ Stopping...');
      this._stop = true;
    };
    process.once('SIGINT', stopHandler);

    try {
      while (!this._stop) {
        if (maxRounds > 0 && roundsDone >= maxRounds) break;

        const pred = this.makePrediction();
        this.printPrediction(pred);

        const secs = WingoAuto.secondsLeft();
        console.log('  ⏳ Waiting for period to end...');
        for (let s = secs; s >= 0; s--) {
          if (this._stop) break;
          WingoAuto.printTimer(s, pred.period);
          if (s > 0) await sleep(1000);
        }
        if (this._stop) break;

        console.log('\n  📡 Fetching result from API...');
        let newResults = [];
        for (let attempt = 0; attempt < 5; attempt++) {
          newResults = await this.fetchNewResults();
          if (newResults.length > 0) break;
          await sleep(CONFIG.poll_interval * 1000);
        }

        if (newResults.length === 0) {
          console.log('  ⚠️  No new result. Trying next period...');
          roundsDone += 1;
          continue;
        }

        const latest = newResults[newResults.length - 1];
        const actualNum = latest.number;
        const actualPeriod = latest.period;
        console.log(`  📥 Result: Period ${actualPeriod} → Number ${actualNum}`);

        const correct = this.resolvePrediction(actualNum, actualPeriod);
        if (correct === true)
          console.log(
            `  🎉 WIN! Predicted ${this.currentPrediction.number} = Actual ${actualNum}`
          );
        else if (correct === false)
          console.log(
            `  😔 LOSS. Predicted ${this.currentPrediction.number} ≠ Actual ${actualNum}`
          );

        this.printStats();
        roundsDone += 1;
      }
    } catch (e) {
      console.log(`\n  ⚠️  Error: ${e.message}`);
    } finally {
      process.removeListener('SIGINT', stopHandler);
    }

    this.running = false;
    console.log('\n' + '═'.repeat(60));
    console.log('  FINAL AUTO STATS');
    console.log('═'.repeat(60));
    this.printStats();
  }
}

// ──────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function fmtTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtPeriod(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(
    d.getHours()
  )}${p(d.getMinutes())}`;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: MAIN
// ══════════════════════════════════════════════════════════════════════

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans)));
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🏆 APEX-Σ — WINGO 1MIN FULLY AUTOMATIC');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n  Modes:');
  console.log('    1. DEMO (fake API, offline test)');
  console.log('    2. LIVE (real API, real results)');
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const mode = (await ask(rl, '  Select mode (1/2): ')).trim() || '1';
  const roundsIn = (await ask(rl, '  Rounds (0 = infinite): ')).trim() || '0';
  rl.close();

  let rounds = parseInt(roundsIn, 10);
  if (!Number.isInteger(rounds)) rounds = 0;

  const demo = mode === '1';
  const engine = new WingoAuto(demo);
  await engine.runAuto(rounds);
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}

module.exports = {
  apexSigma,
  patternLock,
  ensembleAgreement,
  tripleConfirm,
  WingoAuto,
  WingoAPI,
  CONFIG,
  apexState,
};
