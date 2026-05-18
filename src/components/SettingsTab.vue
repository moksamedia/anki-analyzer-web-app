<script setup>
import { ref, onMounted } from 'vue'
import { DEFAULT_ANTHROPIC_MODEL } from '../composables/useClaude.js'
import { DEFAULT_GEMINI_MODEL } from '../composables/useGemini.js'
import { DEFAULT_CARD_USER_PROMPT } from '../composables/useAnkiBridge.js'
import {
  getApiKey,
  setApiKey,
  getGeminiApiKey,
  setGeminiApiKey,
  getAnthropicModel,
  setAnthropicModel,
  getGeminiModel,
  setGeminiModel,
  getCardAnalysisUserPrompt,
  setCardAnalysisUserPrompt
} from '../composables/useStorage.js'

const apiKey = ref('')
const anthropicModel = ref('')
const saved = ref(false)
const saving = ref(false)

const geminiApiKey = ref('')
const geminiModel = ref('')
const geminiSaved = ref(false)
const geminiSaving = ref(false)
const cardPrompt = ref('')
const cardPromptSaved = ref(false)
const cardPromptSaving = ref(false)

onMounted(async () => {
  apiKey.value = await getApiKey()
  anthropicModel.value = await getAnthropicModel()
  geminiApiKey.value = await getGeminiApiKey()
  geminiModel.value = await getGeminiModel()
  cardPrompt.value = await getCardAnalysisUserPrompt()
})

async function save() {
  saving.value = true
  try {
    await setApiKey(apiKey.value)
    await setAnthropicModel(anthropicModel.value)
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  if (!apiKey.value) return
  if (!confirm('Remove the saved Anthropic API key from this browser?')) return
  apiKey.value = ''
  await setApiKey('')
}

async function saveGemini() {
  geminiSaving.value = true
  try {
    await setGeminiApiKey(geminiApiKey.value)
    await setGeminiModel(geminiModel.value)
    geminiSaved.value = true
    setTimeout(() => { geminiSaved.value = false }, 2000)
  } finally {
    geminiSaving.value = false
  }
}

async function clearGeminiKey() {
  if (!geminiApiKey.value) return
  if (!confirm('Remove the saved Gemini API key from this browser?')) return
  geminiApiKey.value = ''
  await setGeminiApiKey('')
}

async function saveCardPrompt() {
  cardPromptSaving.value = true
  try {
    await setCardAnalysisUserPrompt(cardPrompt.value)
    cardPromptSaved.value = true
    setTimeout(() => { cardPromptSaved.value = false }, 2000)
  } finally {
    cardPromptSaving.value = false
  }
}

async function resetCardPrompt() {
  if (!confirm('Reset the Current card analysis prompt to default?')) return
  cardPrompt.value = ''
  await setCardAnalysisUserPrompt('')
}
</script>

<template>
  <div class="section-title">Anthropic API key</div>
  <div class="api-key-row">
    <input
      v-model="apiKey"
      type="password"
      placeholder="sk-ant-..."
      autocomplete="off"
      spellcheck="false"
    />
    <button class="btn" @click="save" :disabled="saving">
      {{ saved ? 'Saved ✓' : 'Save' }}
    </button>
    <button class="btn-outline" @click="clearKey" :disabled="!apiKey">
      Clear
    </button>
  </div>
  <div class="model-override-row" style="margin-bottom: 0.5rem;">
    <label for="anthropic-model" class="hint" style="display: block; margin-bottom: 4px;">
      Model override <span style="font-weight: 400;">(optional — blank uses default)</span>
    </label>
    <input
      id="anthropic-model"
      v-model="anthropicModel"
      type="text"
      class="search-input"
      style="width: 100%; max-width: 480px;"
      :placeholder="'Default: ' + DEFAULT_ANTHROPIC_MODEL"
      autocomplete="off"
      spellcheck="false"
    />
  </div>
  <p class="hint" style="margin-bottom: 1rem;">
    Used for the <strong>AI analysis</strong> tab (deck-level coaching) and
    <strong>Analyze with Claude</strong> on the <strong>Current card</strong> tab.
    Stored in this browser's IndexedDB — sent only to Anthropic's API. Get a key at
    <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.
    Click Save to store the key and optional model override.
  </p>

  <div class="section-title">Google Gemini API key</div>
  <div class="api-key-row">
    <input
      v-model="geminiApiKey"
      type="password"
      placeholder="AIza..."
      autocomplete="off"
      spellcheck="false"
    />
    <button class="btn" @click="saveGemini" :disabled="geminiSaving">
      {{ geminiSaved ? 'Saved ✓' : 'Save' }}
    </button>
    <button class="btn-outline" @click="clearGeminiKey" :disabled="!geminiApiKey">
      Clear
    </button>
  </div>
  <div class="model-override-row" style="margin-bottom: 0.5rem;">
    <label for="gemini-model" class="hint" style="display: block; margin-bottom: 4px;">
      Model override <span style="font-weight: 400;">(optional — blank uses default)</span>
    </label>
    <input
      id="gemini-model"
      v-model="geminiModel"
      type="text"
      class="search-input"
      style="width: 100%; max-width: 480px;"
      :placeholder="'Default: ' + DEFAULT_GEMINI_MODEL"
      autocomplete="off"
      spellcheck="false"
    />
  </div>
  <p class="hint" style="margin-bottom: 1rem;">
    Enables <strong>Analyze with Gemini</strong> on the <strong>Current card</strong> tab.
    Stored locally and sent only to Google's Generative Language API.
    Create a key in
    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a>
    (allow browser restrictions if prompted).
    Click Save to store the key and optional model override.
  </p>

  <div class="section-title">Current card analysis prompt</div>
  <textarea
    v-model="cardPrompt"
    class="search-input"
    rows="4"
    :placeholder="DEFAULT_CARD_USER_PROMPT"
    spellcheck="false"
    style="width: 100%; margin-bottom: 8px;"
  ></textarea>
  <div class="row" style="margin-bottom: 1rem;">
    <button class="btn" @click="saveCardPrompt" :disabled="cardPromptSaving">
      {{ cardPromptSaved ? 'Saved ✓' : 'Save prompt' }}
    </button>
    <button class="btn-outline" @click="resetCardPrompt" :disabled="cardPromptSaving">
      Reset to default
    </button>
  </div>
  <p class="hint" style="margin-bottom: 1rem;">
    Overrides the opening user message used by <strong>Analyze with Claude/Gemini</strong> in the
    <strong>Current card</strong> tab. Stored in IndexedDB.
  </p>

  <div class="section-title">About</div>
  <p class="hint" style="margin: 0;">
    This app talks to two local services:
  </p>
  <ul class="hint" style="margin: 6px 0 0 20px;">
    <li><strong>AnkiConnect</strong> on <code>localhost:8765</code> — for deck-level scans (Overview, Subdecks, Struggling, History, AI analysis tabs).</li>
    <li><strong>anki-ai-bridge</strong> on <code>localhost:8766</code> — for the live current card and FSRS internals (Current card tab).</li>
  </ul>
</template>
