<script setup>
function goBack() {
  location.hash = ''
}
</script>

<template>
  <div class="page">
    <p class="header-links">
      <a href="#" class="text-link" @click.prevent="goBack">← Back to analyzer</a>
    </p>
    <h1>Installation &amp; usage</h1>
    <p class="subtitle" style="margin-bottom: 1.25rem;">
      Set up AnkiConnect and the bridge plugin, configure CORS, then use the analyzer tabs.
    </p>

    <div class="card">
      <div class="section-title">Required plugins</div>
      <p class="hint" style="margin-bottom: 10px;">
        LRZTP Anki Analyzer needs two Anki addons running at the same time:
      </p>
      <ul class="hint" style="margin: 0 0 14px 20px;">
        <li><strong>AnkiConnect</strong> on <code>http://127.0.0.1:8765</code> for deck scans and updates.</li>
        <li><strong>Anki Analyzer Bridge Plugin</strong> on <code>http://127.0.0.1:8766</code> for the Current card tab and FSRS internals.</li>
      </ul>

      <div class="section-title">1) Install AnkiConnect</div>
      <ol class="hint" style="margin: 0 0 14px 20px;">
        <li>Open Anki and go to <strong>Tools -> Add-ons -> Get Add-ons...</strong></li>
        <li>Install <strong>AnkiConnect</strong> and restart Anki.</li>
        <li>After restart, verify Anki is running while this app is open.</li>
      </ol>

      <div class="section-title">2) Install Anki Analyzer Bridge Plugin</div>
      <ol class="hint" style="margin: 0 0 10px 20px;">
        <li>Clone or download the bridge plugin from <code>git@github.com:moksamedia/anki-analyzer-bridge-plugin.git</code>.</li>
        <li>Install it as an Anki add-on from source (into your <code>addons21</code> folder).</li>
        <li>Restart Anki and open the reviewer at least once to initialize bridge endpoints.</li>
      </ol>
      <p class="hint" style="margin-bottom: 14px;">
        HTTPS link:
        <a href="https://github.com/moksamedia/anki-analyzer-bridge-plugin" target="_blank" rel="noopener">github.com/moksamedia/anki-analyzer-bridge-plugin</a>
      </p>

      <div class="section-title">3) CORS configuration (important)</div>
      <div class="error" style="display: block; margin-bottom: 10px;">
        <strong>Both local services must allow this deployed app origin:</strong><br />
        <code>https://moksamedia.github.io</code><br />
        (App URL: <code>https://moksamedia.github.io/anki-analyzer-web-app/</code>)
      </div>
      <p class="hint" style="margin-bottom: 6px;">
        If CORS is not configured, browser requests are blocked before they reach Anki.
      </p>
      <ul class="hint" style="margin: 0 0 10px 20px;">
        <li>Browser console: <code>blocked by CORS policy</code> / <code>Access-Control-Allow-Origin</code> mismatch.</li>
        <li>Network/runtime errors: <code>TypeError: Failed to fetch</code>.</li>
        <li>In app: top-level load failures, and Current card may show bridge unreachable on <code>127.0.0.1:8766</code>.</li>
      </ul>
      <p class="hint" style="margin-bottom: 6px;">
        For AnkiConnect, add allowed origins in Add-on config (<strong>webCorsOriginList</strong>) and restart Anki.
      </p>
      <p class="hint" style="margin-bottom: 6px;">
        Quick option: set <code>"*"</code> to allow all origins while testing.
      </p>
      <pre class="hint" style="margin: 0 0 14px 0; white-space: pre-wrap;"><code>{
  "webCorsOriginList": [
    "https://moksamedia.github.io",
    "http://localhost:5173"
  ]
}</code></pre>
      <p class="hint" style="margin-bottom: 14px;">
        The bridge plugin must also allow the same origin (<code>https://moksamedia.github.io</code>) in its own CORS settings.
      </p>

      <div class="section-title">4) How to use the app</div>
      <ol class="hint" style="margin: 0;">
        <li>Open Anki with both addons loaded.</li>
        <li>In this app, click <strong>Choose deck</strong> and load your target deck.</li>
        <li>Use <strong>Overview / Subdecks / Struggling / History</strong> for deck-level analysis.</li>
        <li>Open a card in Anki reviewer, then use <strong>Current card</strong> -> <strong>Fetch from Anki</strong>.</li>
        <li>Add Anthropic or Gemini API keys in <strong>Settings</strong> to enable AI analysis.</li>
      </ol>
    </div>
  </div>
</template>
