import http from 'node:http'
import Store from 'electron-store'
import log from 'electron-log/main'
import type { AIProvider, ChatOptions } from './types'
import type { ChatChunk, ChatMessage, ToolDefinition } from '../../../../shared/ai-types'

const store = new Store()

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama'
  readonly name = 'ollama'
  readonly displayName = 'Local Ollama'

  async isAvailable(): Promise<boolean> {
    const baseUrl = (store.get('ai.ollama.baseUrl') as string) || 'http://127.0.0.1:11434'
    try {
      const url = new URL('/api/tags', baseUrl)
      const res = await new Promise<boolean>((resolve) => {
        const req = http.get(url, { timeout: 1500 }, (r) => {
          resolve(Boolean(r.statusCode && r.statusCode >= 200 && r.statusCode < 300))
        })
        req.on('error', () => resolve(false))
        req.on('timeout', () => {
          req.destroy()
          resolve(false)
        })
      })
      return res
    } catch {
      return false
    }
  }

  estimateTokens(messages: ChatMessage[]): number {
    let charCount = 0
    for (const msg of messages) {
      charCount += (msg.content?.length ?? 0) + 10
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          charCount += tc.function.name.length + tc.function.arguments.length
        }
      }
    }
    return Math.ceil(charCount / 4)
  }

  async *chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: ChatOptions,
    signal: AbortSignal,
  ): AsyncIterable<ChatChunk> {
    const rawBaseUrl = (store.get('ai.ollama.baseUrl') as string) || 'http://127.0.0.1:11434'
    const storedModel = (store.get('ai.ollama.model') as string) || 'llama3.2'

    const baseUrl = rawBaseUrl.trim().replace(/\/+$/, '')
    const model = options.model || storedModel

    const endpoint = new URL(`${baseUrl}/api/chat`)

    // Format tools for Ollama schema: tools: [{ type: 'function', function: { name, description, parameters } }]
    const formattedTools = tools.length > 0 ? tools : undefined

    const payload = JSON.stringify({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content || '',
      })),
      tools: formattedTools,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
      },
    })

    type ChunkQueueItem = { type: 'chunk'; value: ChatChunk } | { type: 'error'; error: Error } | { type: 'end' }

    const queue: ChunkQueueItem[] = []
    let notifyPending: (() => void) | null = null

    const pushItem = (item: ChunkQueueItem) => {
      queue.push(item)
      if (notifyPending) {
        const cb = notifyPending
        notifyPending = null
        cb()
      }
    }

    const req = http.request(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        signal,
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errBody = ''
          res.on('data', (c) => (errBody += c))
          res.on('end', () => {
            pushItem({
              type: 'error',
              error: new Error(`Ollama error ${res.statusCode}: ${errBody || res.statusMessage}`),
            })
          })
          return
        }

        let buffer = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line) continue

            try {
              const parsed = JSON.parse(line)
              if (parsed.message?.content) {
                pushItem({
                  type: 'chunk',
                  value: { type: 'text', delta: parsed.message.content },
                })
              }

              if (parsed.message?.tool_calls && Array.isArray(parsed.message.tool_calls)) {
                for (let i = 0; i < parsed.message.tool_calls.length; i++) {
                  const tc = parsed.message.tool_calls[i]
                  const callId = `ollama_call_${i}_${Date.now()}`
                  const callName = tc.function?.name || ''
                  const callArgs = tc.function?.arguments || {}
                  pushItem({
                    type: 'chunk',
                    value: {
                      type: 'tool_call_start',
                      id: callId,
                      name: callName,
                    },
                  })
                  pushItem({
                    type: 'chunk',
                    value: {
                      type: 'tool_call_end',
                      id: callId,
                      name: callName,
                      arguments: typeof callArgs === 'string' ? JSON.parse(callArgs) : callArgs,
                    },
                  })
                }
              }

              if (parsed.done) {
                pushItem({
                  type: 'chunk',
                  value: {
                    type: 'done',
                    inputTokens: parsed.prompt_eval_count ?? 0,
                    outputTokens: parsed.eval_count ?? 0,
                  },
                })
              }
            } catch {
              // Ignore partial parse
            }
          }
        })

        res.on('end', () => {
          pushItem({ type: 'end' })
        })

        res.on('error', (err) => {
          pushItem({ type: 'error', error: err })
        })
      },
    )

    req.on('error', (err) => {
      pushItem({ type: 'error', error: err })
    })

    req.write(payload)
    req.end()

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notifyPending = resolve
        })
      }

      while (queue.length > 0) {
        const item = queue.shift()!
        if (item.type === 'error') {
          log.warn('[OllamaProvider] error:', item.error)
          yield { type: 'error', message: item.error.message }
          return
        }
        if (item.type === 'end') {
          return
        }
        yield item.value
      }
    }
  }
}
