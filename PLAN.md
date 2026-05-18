# LRZTP Anki Analyzer — Session Handoff

## Context

This document captures the full state of a development session building a local HTML tool that connects to AnkiConnect and provides AI-powered analysis of an Anki flashcard collection.

### User profile

- Senior Tibetan-to-English translator and Buddhist scholar, Dharamshala
- Studies Classical Tibetan, colloquial Lhasa dialect, Madhyamaka/Gelug philosophy
- Primary Anki deck: **LRZTP** (Lhasa Rinchen Zangpo Tibetan Program) with numbered subdecks `LRZTP::01` through `LRZTP::39-40`, plus `LRZTP Backlog`, `LRZTP Leeches`, and `LRZTP Tibetan` (with Tibetan-script subdeck names)
- macOS (Apple Silicon), Firefox

---

## What was built

A standalone HTML file (`lrztp_analyzer.html`) that:

1. Connects to AnkiConnect (the anki-api plugin) running on `http://127.0.0.1:8765`
2. Fetches all LRZTP decks and subdecks automatically (no deck selection needed)
3. Displays five tabs: Overview, Subdecks, Struggling cards, Review history, AI analysis
4. On the AI tab, accepts an Anthropic API key (stored in localStorage), packages real deck stats into a detailed prompt, and calls `claude-sonnet-4-20250514` for personalized learning suggestions

### Tabs

- **Overview**: 5 metric cards (total cards, due today, avg interval, avg ease, problem cards) + interval histogram + ease factor histogram
- **Subdecks**: proportional bar chart per subdeck with due/new counts
- **Struggling**: top 50 cards sorted by lapse count, with deck, lapse count, ease %, and interval badges
- **History**: 90-day heatmap grid + 30-day line chart of daily review counts
- **AI analysis**: calls Anthropic API with full stats summary; prompt is tuned for Tibetan vocabulary context

---

## Technical details

### AnkiConnect API

- Plugin repo: https://github.com/0xdeadbeer/anki-api (fork of FooSoft/anki-connect)
- Runs HTTP server on `127.0.0.1:8765`
- POST requests with JSON body: `{"action": "...", "version": 6, "params": {...}}`
- Actions used: `deckNames`, `getDeckStats`, `findCards`, `cardsInfo`, `getNumCardsReviewedByDay`

### CORS configuration

The plugin config is at: Anki → Tools → Add-ons → anki-api → Config

Current working config:
```json
{
    "apiKey": null,
    "apiLogPath": null,
    "ignoreOriginList": [],
    "webBindAddress": "127.0.0.1",
    "webBindPort": 8765,
    "webCorsOriginList": [
        "http://localhost",
        "http://localhost:9000",
        "http://localhost:9300",
        "https://claude.ai",
        "null"
    ]
}
```

The `"null"` entry is required for requests from `file://` pages (browsers send `Origin: null` for local HTML files).

### Known issues / what was tried

1. **Claude.ai artifact iframe**: fetch() to localhost is blocked by the browser sandbox regardless of CORS config. The artifact approach was abandoned.
2. **Standalone HTML file**: Works when opened via `file://` in the browser, but requires `"null"` in the CORS list. The error seen was: `CORS header 'Access-Control-Allow-Origin' does not match 'http://localhost'` — fixed by adding `"null"` to the list and restarting Anki.

### Deck detection logic

The tool filters `deckNames` results to include any deck where:
- name === `'LRZTP'`
- name starts with `'LRZTP::'`
- name === `'LRZTP Backlog'`
- name === `'LRZTP Leeches'`
- name starts with `'LRZTP Tibetan'`

Full deck list returned by AnkiConnect (confirmed via curl):
`LRZTP`, `LRZTP::01` through `LRZTP::39-40`, `LRZTP::Extra`, `LRZTP::ZAnatomy`, `LRZTP Backlog`, `LRZTP Leeches`, `LRZTP Tibetan`, `LRZTP Tibetan::འཆད་སྤྲད་ 1-10` (and sub-lessons 2–8)

### Card sampling

The tool fetches `cardsInfo` for a sample of up to 800 card IDs (AnkiConnect can be slow with large batches). For a full-collection analysis, this limit can be raised or pagination added.

### AI prompt

The prompt sent to the Anthropic API includes:
- Total card count and sample size
- Per-subdeck breakdown (total, due, new)
- Interval distribution in 8 bins
- Ease factor distribution in 6 buckets
- 30-day review consistency stats
- Top 15 most-lapsed cards with front content, deck name, lapse count, ease %, interval

Model: `claude-sonnet-4-20250514`, `max_tokens: 1500`

---

## Possible next steps

- Add pagination to `cardsInfo` to analyze all cards rather than a sample
- Add a "leech export" feature — generate a list of leeches with suggested remediation
- Add per-subdeck interval/ease breakdown (currently only global)
- Add a "reset ease" helper — identify cards in ease hell and offer to set them back to 250% via the `setEaseFactors` API
- Persist the last analysis result to localStorage so it survives page reloads
- Add a search/filter box to the Struggling tab

---

## Complete source code

Save the following as `lrztp_analyzer.html` and open it in a browser with Anki running.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LRZTP Anki Analyzer</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #ffffff; --bg2: #f5f5f3; --bg3: #eeece6;
    --text: #1a1a18; --text2: #6b6b66; --text3: #9b9b96;
    --border: rgba(0,0,0,0.1); --border2: rgba(0,0,0,0.2);
    --teal: #1D9E75; --teal-light: #E1F5EE; --teal-dark: #0F6E56;
    --red: #E24B4A; --red-light: #FCEBEB; --red-dark: #A32D2D;
    --amber: #EF9F27; --amber-light: #FAEEDA; --amber-dark: #854F0B;
    --purple-light: #EEEDFE; --purple-dark: #3C3489;
    --gray-light: #F1EFE8; --gray-dark: #5F5E5A;
    --radius: 8px; --radius-lg: 12px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1a18; --bg2: #242422; --bg3: #2e2e2b;
      --text: #f0ede6; --text2: #a0a09a; --text3: #686862;
      --border: rgba(255,255,255,0.1); --border2: rgba(255,255,255,0.2);
      --teal-light: #04342C; --teal-dark: #9FE1CB;
      --red-light: #501313; --red-dark: #F09595;
      --amber-light: #412402; --amber-dark: #FAC775;
      --purple-light: #26215C; --purple-dark: #CECBF6;
      --gray-light: #2C2C2A; --gray-dark: #D3D1C7;
    }
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg3); color: var(--text); min-height: 100vh; }
  .page { max-width: 780px; margin: 0 auto; padding: 2rem 1.5rem; }
  h1 { font-size: 20px; font-weight: 500; margin-bottom: 4px; }
  .subtitle { font-size: 13px; color: var(--text2); margin-bottom: 1.5rem; }
  .card { background: var(--bg); border: 0.5px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1rem; }
  .section-title { font-size: 11px; font-weight: 500; color: var(--text3); text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 10px; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 1.25rem; }
  .metric { background: var(--bg2); border-radius: var(--radius); padding: 12px 14px; }
  .metric-label { font-size: 11px; color: var(--text2); margin-bottom: 5px; }
  .metric-value { font-size: 22px; font-weight: 500; }
  .metric-sub { font-size: 11px; color: var(--text3); margin-top: 2px; }
  .error { background: var(--red-light); border: 0.5px solid var(--red); border-radius: var(--radius); padding: 12px 14px; font-size: 13px; color: var(--red-dark); margin-bottom: 1rem; line-height: 1.6; display: none; }
  .btn { background: var(--text); color: var(--bg); border: none; border-radius: var(--radius); padding: 9px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: inherit; }
  .btn:hover { opacity: 0.85; } .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-outline { background: transparent; color: var(--text); border: 0.5px solid var(--border2); border-radius: var(--radius); padding: 7px 16px; font-size: 13px; cursor: pointer; font-family: inherit; }
  .btn-outline:hover { background: var(--bg2); }
  .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 10px; }
  .deck-tag { font-size: 13px; color: var(--text2); }
  .deck-tag strong { color: var(--text); font-weight: 500; }
  .tabs { display: flex; gap: 2px; border-bottom: 0.5px solid var(--border); margin-bottom: 1.25rem; }
  .tab { font-size: 13px; padding: 8px 14px; cursor: pointer; border: none; border-bottom: 2px solid transparent; color: var(--text2); background: none; font-family: inherit; margin-bottom: -1px; }
  .tab.active { color: var(--text); border-bottom-color: var(--text); font-weight: 500; }
  .tab-panel { display: none; } .tab-panel.active { display: block; }
  .chart-wrap { position: relative; width: 100%; height: 200px; margin-bottom: 1.25rem; }
  .card-item { background: var(--bg); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 10px 13px; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 7px; }
  .card-front { font-size: 13px; flex: 1; word-break: break-word; line-height: 1.5; }
  .badges { display: flex; gap: 5px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .badge { font-size: 11px; padding: 3px 7px; border-radius: 20px; font-weight: 500; white-space: nowrap; }
  .b-red { background: var(--red-light); color: var(--red-dark); }
  .b-amber { background: var(--amber-light); color: var(--amber-dark); }
  .b-gray { background: var(--gray-light); color: var(--gray-dark); }
  .b-teal { background: var(--teal-light); color: var(--teal-dark); }
  .b-purple { background: var(--purple-light); color: var(--purple-dark); }
  .subdeck-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 0.5px solid var(--border); }
  .subdeck-row:last-child { border-bottom: none; }
  .subdeck-name { font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-wrap { flex: 1; max-width: 140px; }
  .bar-bg { height: 5px; background: var(--bg2); border-radius: 3px; }
  .bar-fill { height: 5px; background: var(--teal); border-radius: 3px; }
  .bar-label { font-size: 11px; color: var(--text3); margin-top: 3px; }
  .streak-grid { display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 1.25rem; }
  .sd { width: 13px; height: 13px; border-radius: 2px; background: var(--bg2); }
  .sd1{background:#9FE1CB;}.sd2{background:#5DCAA5;}.sd3{background:#1D9E75;}.sd4{background:#085041;}
  .ai-box { background: var(--bg2); border-radius: var(--radius); padding: 1.25rem; font-size: 14px; line-height: 1.8; white-space: pre-wrap; min-height: 80px; }
  .ai-dim { color: var(--text3); font-style: italic; }
  .spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .6s linear infinite; vertical-align: -2px; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .no-data { font-size: 13px; color: var(--text3); padding: 2rem 0; text-align: center; }
  .api-key-row { display: flex; gap: 8px; align-items: center; margin-bottom: 1rem; }
  .api-key-row input { flex: 1; font-family: monospace; font-size: 13px; padding: 8px 10px; border: 0.5px solid var(--border2); border-radius: var(--radius); background: var(--bg); color: var(--text); }
  .hint { font-size: 12px; color: var(--text3); margin-top: 6px; }
</style>
</head>
<body>
<div class="page">
  <h1>LRZTP Anki Analyzer</h1>
  <p class="subtitle">Connects to AnkiConnect on localhost:8765 · AI analysis via Anthropic API</p>

  <div id="err-box" class="error"></div>

  <div class="card">
    <div class="topbar">
      <div class="deck-tag">Deck: <strong>LRZTP</strong> + all subdecks</div>
      <button class="btn" id="conn-btn" onclick="connectAndLoad()">Connect to Anki</button>
    </div>
    <div class="hint">Make sure Anki is open with the AnkiConnect plugin running.</div>
  </div>

  <div id="main" style="display:none;">
    <div class="card">
      <div class="tabs">
        <button class="tab active" onclick="switchTab('overview')">Overview</button>
        <button class="tab" onclick="switchTab('subdecks')">Subdecks</button>
        <button class="tab" onclick="switchTab('struggling')">Struggling</button>
        <button class="tab" onclick="switchTab('history')">History</button>
        <button class="tab" onclick="switchTab('ai')">AI analysis</button>
      </div>

      <div id="tab-overview" class="tab-panel active">
        <div class="metrics" id="metrics-grid"></div>
        <div class="section-title">Interval distribution</div>
        <div class="chart-wrap"><canvas id="interval-chart" role="img" aria-label="Histogram of card interval lengths">No data.</canvas></div>
        <div class="section-title">Ease factor distribution</div>
        <div class="chart-wrap" style="height:160px;"><canvas id="ease-chart" role="img" aria-label="Histogram of ease factors">No data.</canvas></div>
      </div>

      <div id="tab-subdecks" class="tab-panel">
        <div class="section-title">Per-subdeck breakdown</div>
        <div id="subdeck-list"></div>
      </div>

      <div id="tab-struggling" class="tab-panel">
        <div class="section-title">Highest lapse cards across all LRZTP decks</div>
        <div id="struggling-list"></div>
      </div>

      <div id="tab-history" class="tab-panel">
        <div class="section-title">Daily reviews — last 90 days</div>
        <div class="streak-grid" id="streak-grid"></div>
        <div class="section-title">Last 30 days</div>
        <div class="chart-wrap" style="height:180px;"><canvas id="history-chart" role="img" aria-label="Line chart of daily reviews">No data.</canvas></div>
      </div>

      <div id="tab-ai" class="tab-panel">
        <div class="section-title">Anthropic API key</div>
        <div class="api-key-row">
          <input type="password" id="api-key" placeholder="sk-ant-..." />
          <button class="btn-outline" onclick="saveKey()">Save</button>
        </div>
        <p class="hint" style="margin-bottom:1rem;">Key is stored only in localStorage on this machine. Get yours at console.anthropic.com.</p>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div class="section-title" style="margin:0;">Personalized suggestions</div>
          <button class="btn" id="ai-btn" onclick="runAI()">Analyze my decks</button>
        </div>
        <div id="ai-out" class="ai-box ai-dim">Enter your API key above, then click "Analyze my decks".</div>
      </div>
    </div>
  </div>
</div>

<script>
const ANKI = 'http://127.0.0.1:8765';
let state = {};
let charts = {};

const keyInput = document.getElementById('api-key');
const stored = localStorage.getItem('anthropic_key');
if (stored) keyInput.value = stored;

function saveKey() {
  localStorage.setItem('anthropic_key', keyInput.value.trim());
  keyInput.placeholder = 'Saved ✓';
}

async function anki(action, params = {}) {
  const r = await fetch(ANKI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

async function connectAndLoad() {
  const btn = document.getElementById('conn-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Connecting…';
  document.getElementById('err-box').style.display = 'none';

  try {
    const allDecks = await anki('deckNames');
    const lrztpDecks = allDecks.filter(d => d === 'LRZTP' || d.startsWith('LRZTP::') || d === 'LRZTP Backlog' || d === 'LRZTP Leeches' || d.startsWith('LRZTP Tibetan'));

    if (!lrztpDecks.length) throw new Error('No LRZTP decks found in Anki');

    const [statsResult, reviewsByDay] = await Promise.all([
      anki('getDeckStats', { decks: lrztpDecks }),
      anki('getNumCardsReviewedByDay')
    ]);

    const deckCardMap = {};
    let allCardIds = [];
    for (const deck of lrztpDecks) {
      const ids = await anki('findCards', { query: `deck:"${deck}" -deck:"${deck}::*"` });
      deckCardMap[deck] = ids;
      allCardIds.push(...ids);
    }
    allCardIds = [...new Set(allCardIds)];

    const sample = allCardIds.slice(0, 800);
    const cardsInfo = sample.length > 0 ? await anki('cardsInfo', { cards: sample }) : [];

    const intervals = cardsInfo.map(c => c.interval).filter(i => i > 0);
    const easeFactors = cardsInfo.map(c => c.factor).filter(f => f > 0);
    const lapseCards = cardsInfo.filter(c => c.lapses > 0).sort((a, b) => b.lapses - a.lapses).slice(0, 50);

    state = { lrztpDecks, statsResult, reviewsByDay, deckCardMap, cardsInfo, allCardIds, intervals, easeFactors, lapseCards };

    renderMetrics();
    renderIntervalChart();
    renderEaseChart();
    renderSubdecks();
    renderStruggling();
    renderHistory();

    document.getElementById('main').style.display = 'block';
    document.getElementById('ai-out').textContent = 'Enter your API key above, then click "Analyze my decks".';
    document.getElementById('ai-out').className = 'ai-box ai-dim';
    btn.textContent = 'Reload';
    btn.disabled = false;
  } catch (e) {
    const eb = document.getElementById('err-box');
    eb.style.display = 'block';
    eb.innerHTML = `<strong>Error: ${e.message}</strong><br>Make sure Anki is open and AnkiConnect is running on port 8765.`;
    btn.textContent = 'Connect to Anki';
    btn.disabled = false;
  }
}

function renderMetrics() {
  const { statsResult, allCardIds, intervals, easeFactors, lapseCards } = state;
  let totalDue = 0, totalNew = 0;
  Object.values(statsResult).forEach(s => { totalDue += s.review_count + s.learn_count; totalNew += s.new_count; });
  const avgInt = intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0;
  const avgEase = easeFactors.length ? Math.round(easeFactors.reduce((a, b) => a + b, 0) / easeFactors.length) : 0;
  const lowEase = easeFactors.filter(e => e < 2000).length;
  const highLapse = lapseCards.filter(c => c.lapses >= 5).length;

  document.getElementById('metrics-grid').innerHTML = [
    { label: 'Total cards', value: allCardIds.length.toLocaleString(), sub: `${state.lrztpDecks.length} decks` },
    { label: 'Due today', value: totalDue.toLocaleString(), sub: `+ ${totalNew} new` },
    { label: 'Avg interval', value: avgInt + 'd', sub: 'mature cards' },
    { label: 'Avg ease', value: Math.round(avgEase / 10) + '%', sub: lowEase ? `${lowEase} below 200%` : 'all healthy' },
    { label: 'Problem cards', value: highLapse.toString(), sub: '5+ lapses' },
  ].map(m => `<div class="metric"><div class="metric-label">${m.label}</div><div class="metric-value">${m.value}</div><div class="metric-sub">${m.sub}</div></div>`).join('');
}

function mkChart(id, type, labels, datasets, extra = {}) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), {
    type, data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, ...extra }
  });
}

function renderIntervalChart() {
  const bins = [0, 0, 0, 0, 0, 0, 0, 0];
  state.intervals.forEach(i => {
    if (i <= 1) bins[0]++; else if (i <= 7) bins[1]++; else if (i <= 30) bins[2]++;
    else if (i <= 90) bins[3]++; else if (i <= 180) bins[4]++; else if (i <= 365) bins[5]++;
    else if (i <= 730) bins[6]++; else bins[7]++;
  });
  mkChart('interval-chart', 'bar', ['<1d','1-7d','1-4w','1-3m','3-6m','6-12m','1-2y','>2y'],
    [{ label: 'Cards', data: bins, backgroundColor: '#1D9E75', borderRadius: 4 }],
    { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } });
}

function renderEaseChart() {
  const bins = [0, 0, 0, 0, 0, 0];
  state.easeFactors.forEach(e => {
    if (e < 1500) bins[0]++; else if (e < 2000) bins[1]++; else if (e < 2500) bins[2]++;
    else if (e < 3000) bins[3]++; else if (e < 3500) bins[4]++; else bins[5]++;
  });
  mkChart('ease-chart', 'bar', ['<150%','150-200%','200-250%','250-300%','300-350%','>350%'],
    [{ label: 'Cards', data: bins, backgroundColor: ['#E24B4A','#EF9F27','#1D9E75','#5DCAA5','#9FE1CB','#E1F5EE'], borderRadius: 4 }],
    { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } });
}

function renderSubdecks() {
  const { lrztpDecks, statsResult, deckCardMap } = state;
  const el = document.getElementById('subdeck-list');
  const maxTotal = Math.max(...lrztpDecks.map(d => {
    const s = Object.values(statsResult).find(s => s.name === d);
    return s ? s.total_in_deck : (deckCardMap[d] || []).length;
  }), 1);

  el.innerHTML = lrztpDecks.map(deck => {
    const s = Object.values(statsResult).find(s => s.name === deck);
    const total = s ? s.total_in_deck : (deckCardMap[deck] || []).length;
    const due = s ? s.review_count + s.learn_count : 0;
    const newC = s ? s.new_count : 0;
    const shortName = deck.replace('LRZTP::', '').replace('LRZTP Tibetan::', 'Tib::').replace('LRZTP ', '');
    const pct = Math.round(total / maxTotal * 100);
    return `<div class="subdeck-row">
      <div class="subdeck-name" title="${deck}">${shortName}</div>
      <div class="bar-wrap">
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-label">${total} cards</div>
      </div>
      <div class="badges">
        <span class="badge b-teal">${due} due</span>
        <span class="badge b-purple">${newC} new</span>
      </div>
    </div>`;
  }).join('');
}

function renderStruggling() {
  const el = document.getElementById('struggling-list');
  const { lapseCards } = state;
  if (!lapseCards.length) { el.innerHTML = '<div class="no-data">No cards with lapses — great work!</div>'; return; }
  el.innerHTML = lapseCards.map(c => {
    const front = c.fields ? Object.values(c.fields)[0]?.value?.replace(/<[^>]+>/g, '').trim().slice(0, 130) : '';
    const lClass = c.lapses >= 10 ? 'b-red' : c.lapses >= 5 ? 'b-amber' : 'b-gray';
    const eClass = c.factor < 1500 ? 'b-red' : c.factor < 2000 ? 'b-amber' : 'b-teal';
    const dn = (c.deckName || '').replace('LRZTP::', '').replace('LRZTP Tibetan::', 'Tib::').replace('LRZTP ', '');
    return `<div class="card-item">
      <div class="card-front">${front || '(media card)'}</div>
      <div class="badges">
        <span class="badge b-gray">${dn}</span>
        <span class="badge ${lClass}">${c.lapses} lapses</span>
        <span class="badge ${eClass}">${Math.round(c.factor / 10)}% ease</span>
        <span class="badge b-gray">${c.interval}d</span>
      </div>
    </div>`;
  }).join('');
}

function renderHistory() {
  const { reviewsByDay } = state;
  const cutoff90 = Date.now() - 90 * 86400000;
  const recentMap = {};
  reviewsByDay.forEach(([date, count]) => { if (new Date(date).getTime() >= cutoff90) recentMap[date] = count; });
  const maxC = Math.max(...Object.values(recentMap), 1);

  const days = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const count = recentMap[key] || 0;
    const lvl = count === 0 ? 0 : count < maxC * .25 ? 1 : count < maxC * .5 ? 2 : count < maxC * .75 ? 3 : 4;
    days.push({ key, count, lvl });
  }

  document.getElementById('streak-grid').innerHTML = days.map(d =>
    `<div class="sd sd${d.lvl}" title="${d.key}: ${d.count} reviews"></div>`
  ).join('');

  const last30 = days.slice(-30);
  mkChart('history-chart', 'line',
    last30.map(d => d.key.slice(5)),
    [{ label: 'Reviews', data: last30.map(d => d.count), borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.1)', fill: true, tension: .3, pointRadius: 3, pointBackgroundColor: '#1D9E75' }],
    { scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }
  );
}

async function runAI() {
  const key = keyInput.value.trim() || localStorage.getItem('anthropic_key') || '';
  if (!key) { alert('Please enter your Anthropic API key in the field above.'); return; }
  if (!state.lrztpDecks) { alert('Connect to Anki first.'); return; }

  const btn = document.getElementById('ai-btn');
  const out = document.getElementById('ai-out');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analyzing…';
  out.className = 'ai-box ai-dim';
  out.textContent = 'Gathering your data and calling Claude…';

  const { lrztpDecks, statsResult, intervals, easeFactors, lapseCards, allCardIds, cardsInfo, reviewsByDay, deckCardMap } = state;

  let totalDue = 0, totalNew = 0;
  Object.values(statsResult).forEach(s => { totalDue += s.review_count + s.learn_count; totalNew += s.new_count; });
  const avgInt = intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0;
  const avgEase = easeFactors.length ? Math.round(easeFactors.reduce((a, b) => a + b, 0) / easeFactors.length) : 0;

  const cutoff30 = Date.now() - 30 * 86400000;
  const last30 = reviewsByDay.filter(([d]) => new Date(d).getTime() >= cutoff30);
  const last30Total = last30.reduce((s, [, c]) => s + c, 0);
  const activeDays = last30.filter(([, c]) => c > 0).length;

  const subdeckSummary = lrztpDecks.map(deck => {
    const s = Object.values(statsResult).find(s => s.name === deck);
    const shortName = deck.replace('LRZTP::', '').replace('LRZTP Tibetan::', 'Tib::').replace('LRZTP ', '');
    return s ? `  ${shortName}: ${s.total_in_deck} cards, ${s.review_count + s.learn_count} due, ${s.new_count} new`
      : `  ${shortName}: ${(deckCardMap[deck] || []).length} cards`;
  }).join('\n');

  const intBins = [0, 0, 0, 0, 0, 0, 0, 0];
  intervals.forEach(i => {
    if (i <= 1) intBins[0]++; else if (i <= 7) intBins[1]++; else if (i <= 30) intBins[2]++;
    else if (i <= 90) intBins[3]++; else if (i <= 180) intBins[4]++; else if (i <= 365) intBins[5]++;
    else if (i <= 730) intBins[6]++; else intBins[7]++;
  });

  const topLapsers = lapseCards.slice(0, 15).map(c => {
    const front = c.fields ? Object.values(c.fields)[0]?.value?.replace(/<[^>]+>/g, '').trim().slice(0, 80) : '(media)';
    const dn = (c.deckName || '').replace('LRZTP::', '').replace('LRZTP Tibetan::', 'Tib::').replace('LRZTP ', '');
    return `  [${dn}] "${front}" — ${c.lapses} lapses, ${Math.round(c.factor / 10)}% ease, ${c.interval}d interval`;
  }).join('\n');

  const prompt = `You are an expert Anki coach reviewing the flashcard collection of a senior Tibetan-to-English translator and Buddhist scholar based in Dharamshala. They study Classical Tibetan, colloquial Lhasa dialect, and Buddhist philosophy (Madhyamaka/Gelug tradition). Their collection is organized under "LRZTP" (Lhasa Rinchen Zangpo Tibetan Program) with numbered subdecks (01–40) corresponding to lessons.

COLLECTION OVERVIEW:
- Total cards (all LRZTP): ${allCardIds.length}
- Analyzed sample: ${cardsInfo.length} cards
- Due today: ${totalDue} reviews + ${totalNew} new
- Subdecks (${lrztpDecks.length} total):
${subdeckSummary}

INTERVAL HEALTH:
- Average interval: ${avgInt} days
- ≤1 day: ${intBins[0]}, 2-7 days: ${intBins[1]}, 1-4 weeks: ${intBins[2]}, 1-3 months: ${intBins[3]}, 3-6 months: ${intBins[4]}, 6-12 months: ${intBins[5]}, 1-2 years: ${intBins[6]}, >2 years: ${intBins[7]}

EASE FACTOR HEALTH:
- Average ease: ${Math.round(avgEase / 10)}%
- Below 150%: ${easeFactors.filter(e => e < 1500).length} (critical)
- 150-200%: ${easeFactors.filter(e => e >= 1500 && e < 2000).length} (struggling)
- 200-250%: ${easeFactors.filter(e => e >= 2000 && e < 2500).length} (normal)
- Above 250%: ${easeFactors.filter(e => e >= 2500).length} (strong)

REVIEW CONSISTENCY (last 30 days):
- Active days: ${activeDays}/30
- Total reviews: ${last30Total}
- Daily average: ${Math.round(last30Total / 30)}

TOP LAPSED CARDS:
${topLapsers}

Please provide a thorough, expert analysis:

1. Overall collection health — what the numbers say about retention and maturity
2. Subdeck balance — which subdecks need more or less attention
3. Ease factor concerns — any "ease hell" patterns and how to address them
4. Struggling card analysis — given these are Tibetan vocabulary cards, what likely causes these lapses (script complexity, phonetic homophones, grammatical particles, polysemy, Classical vs. colloquial overlap) and specific strategies for the worst offenders
5. Review habit assessment — what the consistency data suggests
6. Deck settings recommendations (new cards/day, review limits, lapse penalties, leech thresholds)
7. Three specific action items for this week

Be direct and technical — this person knows Tibetan well and understands how Anki's SRS algorithm works.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || 'No response.';
    out.className = 'ai-box';
    out.textContent = text;
  } catch (e) {
    out.className = 'ai-box';
    out.textContent = `Error: ${e.message}`;
  }
  btn.textContent = 'Re-analyze';
  btn.disabled = false;
}

function switchTab(name) {
  const names = ['overview', 'subdecks', 'struggling', 'history', 'ai'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
}
</script>
</body>
</html>
```