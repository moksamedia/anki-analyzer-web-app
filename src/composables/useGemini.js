const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
/** @see https://ai.google.dev/gemini-api/docs/models */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

function geminiContentsFromMessages(messages) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : String(m.content) }]
  }))
}

/**
 * Streams a chat compatible with Claude-style `messages`: { role: 'user'|'assistant', content }.
 */
export async function* streamGeminiMessages(apiKey, messages, options = {}) {
  const maxTokens = options.maxTokens ?? 4096
  const systemText = options.systemText ?? ''
  const modelRaw = typeof options.model === 'string' ? options.model.trim() : ''
  const model = modelRaw || DEFAULT_GEMINI_MODEL

  const url = `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse`
  const body = {
    contents: geminiContentsFromMessages(messages),
    generationConfig: { maxOutputTokens: maxTokens }
  }
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    let detail = ''
    try {
      const err = await res.json()
      detail = err.error?.message || JSON.stringify(err)
    } catch {
      detail = await res.text()
    }
    throw new Error(`Gemini API error (${res.status}): ${detail}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('Gemini stream could not be read.')

  const decoder = new TextDecoder()
  let buffer = ''
  let lastUsage = null
  let assembled = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let event
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }

      const text = extractModelText(event)
      if (text) {
        let delta = text
        if (assembled.startsWith(text)) {
          delta = ''
        } else if (assembled.length && text.startsWith(assembled)) {
          delta = text.slice(assembled.length)
          assembled = text
        } else {
          assembled += text
        }
        if (delta) yield { type: 'text', text: delta }
      }

      const um = event.usageMetadata
      if (um) {
        lastUsage = {
          input_tokens: um.promptTokenCount ?? 0,
          output_tokens: um.candidatesTokenCount ?? 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0
        }
      }

      const block = event.promptFeedback?.blockReason
      if (block) {
        throw new Error(`Gemini blocked this request: ${block}`)
      }
    }
  }

  if (lastUsage) {
    yield { type: 'usage', usage: lastUsage }
  } else {
    yield {
      type: 'usage',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      }
    }
  }
}

function extractModelText(parsed) {
  const cands = parsed.candidates
  if (!cands?.length) return ''
  const parts = cands[0]?.content?.parts
  if (!parts?.length) return ''
  return parts.map(p => (typeof p.text === 'string' ? p.text : '')).join('')
}
