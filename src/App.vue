<script setup>
import { ref, computed, onMounted } from 'vue'
import { loadAllData, fetchDeckNames } from './composables/useAnki.js'
import { computeOverview } from './composables/useAnalysis.js'
import {
  saveAnkiSnapshot,
  loadAnkiSnapshot,
  clearAnkiSnapshot,
  getDeckSelection,
  setDeckSelection,
  getSchedulerOverride,
  setSchedulerOverride
} from './composables/useStorage.js'
import OverviewTab from './components/OverviewTab.vue'
import SubdecksTab from './components/SubdecksTab.vue'
import StrugglingTab from './components/StrugglingTab.vue'
import HistoryTab from './components/HistoryTab.vue'
import AITab from './components/AITab.vue'
import CurrentCardTab from './components/CurrentCardTab.vue'
import SettingsTab from './components/SettingsTab.vue'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'subdecks', label: 'Subdecks' },
  { id: 'struggling', label: 'Struggling' },
  { id: 'history', label: 'History' },
  { id: 'ai', label: 'AI analysis' },
  { id: 'current-card', label: 'Current card' },
  { id: 'settings', label: 'Settings' }
]

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

const activeTab = ref('overview')
const isConnecting = ref(false)
const isLoadingCache = ref(true)
const error = ref('')
const data = ref(null)
const progress = ref(null)
const cachedAt = ref(null)

const showPicker = ref(false)
const isFetchingDecks = ref(false)
const deckList = ref([])
const pickerDeck = ref('')
const pickerIncludeSubdecks = ref(true)
const pickerSearch = ref('')

const schedulerOverride = ref('auto')

const overview = computed(() => data.value ? computeOverview(data.value) : null)

const effectiveUsesFsrs = computed(() => {
  if (schedulerOverride.value === 'fsrs') return true
  if (schedulerOverride.value === 'sm2') return false
  return data.value?.usesFsrs ?? false
})

const detectedSchedulerLabel = computed(() => {
  if (!data.value) return ''
  return data.value.usesFsrs ? 'FSRS' : 'SM-2'
})

async function onSchedulerOverrideChange() {
  await setSchedulerOverride(schedulerOverride.value)
}

onMounted(async () => {
  try {
    const [snapshot, savedSelection, savedOverride] = await Promise.all([
      loadAnkiSnapshot(),
      getDeckSelection(),
      getSchedulerOverride()
    ])
    if (snapshot) {
      data.value = snapshot.data
      cachedAt.value = snapshot.savedAt
    }
    if (savedSelection) {
      pickerDeck.value = savedSelection.rootDeck
      pickerIncludeSubdecks.value = savedSelection.includeSubdecks
    }
    schedulerOverride.value = savedOverride
  } finally {
    isLoadingCache.value = false
  }
})

async function openPicker() {
  isFetchingDecks.value = true
  error.value = ''
  try {
    deckList.value = await fetchDeckNames()
    if (!pickerDeck.value && data.value?.rootDeck) {
      pickerDeck.value = data.value.rootDeck
      pickerIncludeSubdecks.value = data.value.includeSubdecks ?? true
    }
    if (!pickerDeck.value && deckList.value.length) {
      const lrztp = deckList.value.find(d => d === 'LRZTP')
      pickerDeck.value = lrztp || deckList.value[0]
    }
    showPicker.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    isFetchingDecks.value = false
  }
}

function cancelPicker() {
  showPicker.value = false
  pickerSearch.value = ''
}

async function loadFromPicker() {
  if (!pickerDeck.value) return
  showPicker.value = false
  pickerSearch.value = ''
  await setDeckSelection({
    rootDeck: pickerDeck.value,
    includeSubdecks: pickerIncludeSubdecks.value
  })
  await runLoad({
    rootDeck: pickerDeck.value,
    includeSubdecks: pickerIncludeSubdecks.value
  })
}

async function refreshCurrent() {
  if (!data.value) return
  await runLoad({
    rootDeck: data.value.rootDeck,
    includeSubdecks: data.value.includeSubdecks
  })
}

async function runLoad(selection) {
  isConnecting.value = true
  error.value = ''
  progress.value = { phase: 'init', message: 'Connecting to AnkiConnect…' }

  try {
    const fresh = await loadAllData(selection, p => {
      progress.value = p
    })
    data.value = fresh
    progress.value = { phase: 'save', message: 'Saving snapshot…' }
    cachedAt.value = await saveAnkiSnapshot(fresh)
    progress.value = null
  } catch (e) {
    error.value = e.message
  } finally {
    isConnecting.value = false
  }
}

async function clearCache() {
  if (!confirm('Clear cached Anki data? You will need to reload to see deck stats again.')) return
  await clearAnkiSnapshot()
  data.value = null
  cachedAt.value = null
}

const progressPct = computed(() => {
  if (!progress.value || !progress.value.total) return 0
  return Math.round(progress.value.processed / progress.value.total * 100)
})

const cachedAtFormatted = computed(() => {
  if (!cachedAt.value) return ''
  return new Date(cachedAt.value).toLocaleString()
})

const cacheIsStale = computed(() => {
  if (!cachedAt.value) return false
  return Date.now() - new Date(cachedAt.value).getTime() > STALE_THRESHOLD_MS
})

const filteredDeckList = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  if (!q) return deckList.value
  return deckList.value.filter(d => d.toLowerCase().includes(q))
})

const subdeckCount = computed(() => {
  if (!pickerDeck.value || !pickerIncludeSubdecks.value) return 0
  const prefix = pickerDeck.value + '::'
  return deckList.value.filter(d => d.startsWith(prefix)).length
})
</script>

<template>
  <div class="page">
    <h1>LRZTP Anki Analyzer</h1>
    <p class="subtitle">Connects to AnkiConnect on localhost:8765 · AI via Anthropic or Google Gemini APIs</p>

    <div v-if="error" class="error" style="display: block;">
      <strong>Error: {{ error }}</strong><br />
      Make sure Anki is open and AnkiConnect is running on port 8765.
    </div>

    <div class="card">
      <div class="topbar">
        <div class="deck-tag">
          <template v-if="data">
            Deck: <strong>{{ data.rootDeck }}</strong>
            <span v-if="data.includeSubdecks" style="color: var(--text3);"> · with subdecks ({{ data.selectedDecks.length - 1 }})</span>
            <span v-else style="color: var(--text3);"> · root only</span>
            <select
              v-model="schedulerOverride"
              @change="onSchedulerOverrideChange"
              class="scheduler-select"
              :class="schedulerOverride === 'auto' ? (data.usesFsrs ? 'sched-fsrs' : 'sched-sm2') : (effectiveUsesFsrs ? 'sched-fsrs' : 'sched-sm2')"
              :title="schedulerOverride === 'auto' ? 'Detected from deck config' : 'Manual override (auto-detected: ' + detectedSchedulerLabel + ')'"
            >
              <option value="auto">Auto · {{ detectedSchedulerLabel }}</option>
              <option value="sm2">SM-2 (manual)</option>
              <option value="fsrs">FSRS (manual)</option>
            </select>
          </template>
          <template v-else>
            <span style="color: var(--text2);">No deck loaded</span>
          </template>
        </div>
        <div class="row">
          <button v-if="data" class="btn-outline" @click="clearCache" :disabled="isConnecting">
            Clear cache
          </button>
          <button
            class="btn-outline"
            @click="openPicker"
            :disabled="isConnecting || isLoadingCache || isFetchingDecks"
          >
            <span v-if="isFetchingDecks" class="spinner spinner-dark"></span>
            {{ data ? 'Change deck' : 'Choose deck' }}
          </button>
          <button
            v-if="data"
            class="btn"
            @click="refreshCurrent"
            :disabled="isConnecting || isLoadingCache"
          >
            <span v-if="isConnecting" class="spinner"></span>
            {{ isConnecting ? 'Loading…' : 'Refresh from Anki' }}
          </button>
        </div>
      </div>
      <div v-if="isLoadingCache" class="hint">
        Restoring cached snapshot…
      </div>
      <div v-else-if="!data && !isConnecting && !isFetchingDecks" class="hint">
        Make sure Anki is open with the AnkiConnect plugin running, then click "Choose deck".
      </div>
      <div v-else-if="cachedAt && !isConnecting" class="hint">
        <span :class="cacheIsStale ? 'cache-stale' : ''">
          Loaded from cache · saved {{ cachedAtFormatted }}{{ cacheIsStale ? ' · over 24h old' : '' }}
        </span>
      </div>
      <div v-if="progress" class="progress">
        {{ progress.message }}
        <span v-if="progress.total">{{ progress.processed }} / {{ progress.total }}</span>
        <div v-if="progress.total" class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
        </div>
      </div>
    </div>

    <div v-if="showPicker" class="modal-backdrop" @click.self="cancelPicker">
      <div class="modal" style="max-width: 560px;">
        <h2>Choose a deck</h2>
        <p>Pick the deck you want to analyze. Optionally include all of its subdecks.</p>

        <input
          v-model="pickerSearch"
          class="search-input"
          placeholder="Search decks…"
          style="margin-bottom: 8px;"
        />

        <select
          v-model="pickerDeck"
          class="search-input"
          size="10"
          style="width: 100%; min-width: 0; height: auto; padding: 4px;"
        >
          <option
            v-for="d in filteredDeckList"
            :key="d"
            :value="d"
          >{{ d }}</option>
        </select>

        <label class="row" style="margin-top: 14px; gap: 8px; cursor: pointer;">
          <input type="checkbox" v-model="pickerIncludeSubdecks" />
          <span style="font-size: 13px;">
            Include subdecks
            <span v-if="pickerIncludeSubdecks && subdeckCount > 0" style="color: var(--text2);">
              ({{ subdeckCount }} subdeck{{ subdeckCount === 1 ? '' : 's' }})
            </span>
          </span>
        </label>

        <div class="modal-actions">
          <button class="btn-outline" @click="cancelPicker">Cancel</button>
          <button class="btn" @click="loadFromPicker" :disabled="!pickerDeck">
            Load deck
          </button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="tabs">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          class="tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-show="activeTab === 'current-card'">
        <CurrentCardTab
          :loaded-deck="data?.rootDeck || ''"
          :loaded-includes-subdecks="data?.includeSubdecks ?? false"
          :loaded-overview="overview"
          :loaded-reviews-by-day="data?.reviewsByDay || null"
          :loaded-uses-fsrs="effectiveUsesFsrs"
        />
      </div>

      <div v-show="activeTab === 'settings'">
        <SettingsTab />
      </div>

      <template v-if="data">
        <div v-show="activeTab === 'overview'">
          <OverviewTab :overview="overview" :uses-fsrs="effectiveUsesFsrs" />
        </div>
        <div v-show="activeTab === 'subdecks'">
          <SubdecksTab
            :selected-decks="data.selectedDecks"
            :stats-result="data.statsResult"
            :deck-card-map="data.deckCardMap"
            :cards-info="data.cardsInfo"
            :uses-fsrs="effectiveUsesFsrs"
          />
        </div>
        <div v-show="activeTab === 'struggling'">
          <StrugglingTab :lapse-cards="overview.lapseCards" :uses-fsrs="effectiveUsesFsrs" />
        </div>
        <div v-show="activeTab === 'history'">
          <HistoryTab :reviews-by-day="data.reviewsByDay" />
        </div>
        <div v-show="activeTab === 'ai'">
          <AITab
            :overview="overview"
            :selected-decks="data.selectedDecks"
            :root-deck="data.rootDeck"
            :include-subdecks="data.includeSubdecks"
            :stats-result="data.statsResult"
            :deck-card-map="data.deckCardMap"
            :reviews-by-day="data.reviewsByDay"
            :uses-fsrs="effectiveUsesFsrs"
          />
        </div>
      </template>
      <div v-else-if="!['current-card', 'settings'].includes(activeTab)" class="hint" style="padding: 16px;">
        Load a deck above to populate this tab. The "Current card" and "Settings" tabs work without a loaded deck.
      </div>
    </div>
  </div>
</template>
