import { get, set, del } from 'idb-keyval'
import { ref } from 'vue'

const SNAPSHOT_KEY = 'lrztp_anki_snapshot'
const SNAPSHOT_VERSION = 1
const API_KEY_KEY = 'anthropic_api_key'
const GEMINI_API_KEY_KEY = 'gemini_api_key'
const LEGACY_API_KEY = 'anthropic_key'
const DECK_SELECTION_KEY = 'lrztp_deck_selection'
const SCHEDULER_OVERRIDE_KEY = 'lrztp_scheduler_override'
const ANTHROPIC_MODEL_KEY = 'lrztp_anthropic_model'
const GEMINI_MODEL_KEY = 'lrztp_gemini_model'
const CURRENT_CARD_AUTO_UPDATE_KEY = 'lrztp_current_card_auto_update'
const CARD_ANALYSIS_USER_PROMPT_KEY = 'lrztp_card_analysis_user_prompt'

export async function getSchedulerOverride() {
  try {
    const value = await get(SCHEDULER_OVERRIDE_KEY)
    if (value === 'sm2' || value === 'fsrs') return value
    return 'auto'
  } catch {
    return 'auto'
  }
}

export async function setSchedulerOverride(value) {
  if (value === 'auto' || !value) {
    await del(SCHEDULER_OVERRIDE_KEY)
    return
  }
  if (value !== 'sm2' && value !== 'fsrs') return
  await set(SCHEDULER_OVERRIDE_KEY, value)
}

export async function getDeckSelection() {
  try {
    const sel = await get(DECK_SELECTION_KEY)
    if (!sel || typeof sel.rootDeck !== 'string') return null
    return {
      rootDeck: sel.rootDeck,
      includeSubdecks: sel.includeSubdecks !== false
    }
  } catch {
    return null
  }
}

export async function setDeckSelection(selection) {
  if (!selection?.rootDeck) {
    await del(DECK_SELECTION_KEY)
    return
  }
  await set(DECK_SELECTION_KEY, {
    rootDeck: selection.rootDeck,
    includeSubdecks: selection.includeSubdecks !== false
  })
}

const _apiKeyRef = ref('')
let _apiKeyLoaded = false

async function _loadFromStorage() {
  try {
    const fromIdb = await get(API_KEY_KEY)
    if (fromIdb) return fromIdb
    const legacy = localStorage.getItem(LEGACY_API_KEY)
    if (legacy) {
      await set(API_KEY_KEY, legacy)
      localStorage.removeItem(LEGACY_API_KEY)
      return legacy
    }
    return ''
  } catch {
    return localStorage.getItem(LEGACY_API_KEY) || ''
  }
}

export async function getApiKey() {
  if (!_apiKeyLoaded) {
    _apiKeyRef.value = await _loadFromStorage()
    _apiKeyLoaded = true
  }
  return _apiKeyRef.value
}

export async function setApiKey(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) {
    await del(API_KEY_KEY)
  } else {
    await set(API_KEY_KEY, trimmed)
  }
  _apiKeyRef.value = trimmed
  _apiKeyLoaded = true
}

// Shared reactive ref for components that want to react to changes.
export function useApiKey() {
  if (!_apiKeyLoaded) {
    getApiKey()  // fire-and-forget; ref updates when load completes
  }
  return _apiKeyRef
}

const _geminiApiKeyRef = ref('')
let _geminiApiKeyLoaded = false

export async function getGeminiApiKey() {
  if (!_geminiApiKeyLoaded) {
    try {
      const v = await get(GEMINI_API_KEY_KEY)
      _geminiApiKeyRef.value = typeof v === 'string' ? v : ''
    } catch {
      _geminiApiKeyRef.value = ''
    }
    _geminiApiKeyLoaded = true
  }
  return _geminiApiKeyRef.value
}

export async function setGeminiApiKey(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) {
    await del(GEMINI_API_KEY_KEY)
  } else {
    await set(GEMINI_API_KEY_KEY, trimmed)
  }
  _geminiApiKeyRef.value = trimmed
  _geminiApiKeyLoaded = true
}

export function useGeminiApiKey() {
  if (!_geminiApiKeyLoaded) {
    getGeminiApiKey()
  }
  return _geminiApiKeyRef
}

const _anthropicModelRef = ref('')
let _anthropicModelLoaded = false

export async function getAnthropicModel() {
  if (!_anthropicModelLoaded) {
    try {
      const v = await get(ANTHROPIC_MODEL_KEY)
      _anthropicModelRef.value = typeof v === 'string' ? v : ''
    } catch {
      _anthropicModelRef.value = ''
    }
    _anthropicModelLoaded = true
  }
  return _anthropicModelRef.value
}

export async function setAnthropicModel(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) {
    await del(ANTHROPIC_MODEL_KEY)
  } else {
    await set(ANTHROPIC_MODEL_KEY, trimmed)
  }
  _anthropicModelRef.value = trimmed
  _anthropicModelLoaded = true
}

export function useAnthropicModel() {
  if (!_anthropicModelLoaded) {
    getAnthropicModel()
  }
  return _anthropicModelRef
}

const _geminiModelRef = ref('')
let _geminiModelLoaded = false

export async function getGeminiModel() {
  if (!_geminiModelLoaded) {
    try {
      const v = await get(GEMINI_MODEL_KEY)
      _geminiModelRef.value = typeof v === 'string' ? v : ''
    } catch {
      _geminiModelRef.value = ''
    }
    _geminiModelLoaded = true
  }
  return _geminiModelRef.value
}

export async function setGeminiModel(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) {
    await del(GEMINI_MODEL_KEY)
  } else {
    await set(GEMINI_MODEL_KEY, trimmed)
  }
  _geminiModelRef.value = trimmed
  _geminiModelLoaded = true
}

export function useGeminiModel() {
  if (!_geminiModelLoaded) {
    getGeminiModel()
  }
  return _geminiModelRef
}

export async function getCurrentCardAutoUpdate() {
  try {
    const value = await get(CURRENT_CARD_AUTO_UPDATE_KEY)
    return value === true
  } catch {
    return false
  }
}

export async function setCurrentCardAutoUpdate(value) {
  if (value) {
    await set(CURRENT_CARD_AUTO_UPDATE_KEY, true)
  } else {
    await del(CURRENT_CARD_AUTO_UPDATE_KEY)
  }
}

const _cardAnalysisUserPromptRef = ref('')
let _cardAnalysisUserPromptLoaded = false

export async function getCardAnalysisUserPrompt() {
  if (!_cardAnalysisUserPromptLoaded) {
    try {
      const value = await get(CARD_ANALYSIS_USER_PROMPT_KEY)
      _cardAnalysisUserPromptRef.value = typeof value === 'string' ? value : ''
    } catch {
      _cardAnalysisUserPromptRef.value = ''
    }
    _cardAnalysisUserPromptLoaded = true
  }
  return _cardAnalysisUserPromptRef.value
}

export async function setCardAnalysisUserPrompt(value) {
  const next = typeof value === 'string' ? value : ''
  if (!next.trim()) {
    await del(CARD_ANALYSIS_USER_PROMPT_KEY)
    _cardAnalysisUserPromptRef.value = ''
  } else {
    await set(CARD_ANALYSIS_USER_PROMPT_KEY, next)
    _cardAnalysisUserPromptRef.value = next
  }
  _cardAnalysisUserPromptLoaded = true
}

export function useCardAnalysisUserPrompt() {
  if (!_cardAnalysisUserPromptLoaded) {
    getCardAnalysisUserPrompt()
  }
  return _cardAnalysisUserPromptRef
}

export async function saveAnkiSnapshot(data) {
  const snapshot = {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    data
  }
  try {
    await set(SNAPSHOT_KEY, snapshot)
    return snapshot.savedAt
  } catch (e) {
    console.warn('Failed to save Anki snapshot to IndexedDB:', e)
    return null
  }
}

export async function loadAnkiSnapshot() {
  try {
    const snapshot = await get(SNAPSHOT_KEY)
    if (!snapshot) return null
    if (snapshot.version !== SNAPSHOT_VERSION) return null
    if (!snapshot.data) return null
    const data = migrateSnapshotData(snapshot.data)
    if (!data) return null
    return { savedAt: snapshot.savedAt, data }
  } catch (e) {
    console.warn('Failed to load Anki snapshot:', e)
    return null
  }
}

function migrateSnapshotData(data) {
  if (Array.isArray(data.selectedDecks)) return data
  if (Array.isArray(data.lrztpDecks)) {
    const inferred = data.lrztpDecks.includes('LRZTP') ? 'LRZTP' : data.lrztpDecks[0]
    return {
      ...data,
      selectedDecks: data.lrztpDecks,
      rootDeck: data.rootDeck || inferred,
      includeSubdecks: data.includeSubdecks ?? true
    }
  }
  return null
}

export async function clearAnkiSnapshot() {
  try {
    await del(SNAPSHOT_KEY)
  } catch (e) {
    console.warn('Failed to clear Anki snapshot:', e)
  }
}
