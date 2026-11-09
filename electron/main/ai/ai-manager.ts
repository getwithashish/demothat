import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type { AIChatRequest, ChatChunk, ChatMessage } from '../../../shared/ai-types'
import { ALL_AI_TOOLS, isToolDestructive } from './tools'
import { providerRouter } from './provider-router'
import { buildSystemMessage } from './system-prompt'
import { executeTool } from './tool-executor'
import { appState } from '../state'

interface PendingApproval {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  resolve: (approved: boolean) => void
}

export class AIManager {
  private activeAbortController: AbortController | null = null
  private pendingApprovals = new Map<string, PendingApproval>()

  private emit(win: BrowserWindow | null, chunk: ChatChunk): void {
    const target = win && !win.isDestroyed() ? win : appState.editorWin
    if (!target || target.isDestroyed()) return
    target.webContents.send('ai:chunk', chunk)
  }

  cancel(): void {
    if (this.activeAbortController) {
      log.info('[AIManager] Cancelling active AI conversation stream.')
      this.activeAbortController.abort()
      this.activeAbortController = null
    }
  }

  handleApprovalDecision(toolCallId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(toolCallId)
    if (pending) {
      this.pendingApprovals.delete(toolCallId)
      pending.resolve(approved)
    }
  }

  async runChat(win: BrowserWindow | null, request: AIChatRequest): Promise<void> {
    this.cancel() // Cancel any prior in-flight stream

    const abortController = new AbortController()
    this.activeAbortController = abortController
    const { signal } = abortController

    const provider = providerRouter.getProvider(request.providerId)

    // Build project context string for Ed's system prompt
    const contextLines: string[] = [
      `Timeline Duration: ${request.context.duration.toFixed(2)}s | Current Playhead Time: ${request.context.currentTime.toFixed(2)}s`,
      `Aspect Ratio: ${request.context.aspectRatio}`,
      `Selected Region ID: ${request.context.selectedRegionId ?? 'None'} (Type: ${request.context.selectedRegionType ?? 'None'})`,
      `Regions on Timeline: ${request.context.timelineSummary.zoomRegionsCount} zooms, ${request.context.timelineSummary.cutRegionsCount} cuts, ${request.context.timelineSummary.speedRegionsCount} speed regions, ${request.context.timelineSummary.subtitleCuesCount} captions.`,
    ]

    if (request.context.selectedRegionDetails) {
      contextLines.push(`Selected Region Details: ${JSON.stringify(request.context.selectedRegionDetails)}`)
    }

    if (request.context.recentClicks && request.context.recentClicks.length > 0) {
      const clickSummary = request.context.recentClicks
        .slice(-5)
        .map((c) => `t=${c.timestamp.toFixed(2)}s (x=${c.x}, y=${c.y})`)
        .join(', ')
      contextLines.push(`Recent Clicks: ${clickSummary}`)
    }

    if (request.context.transcript?.segments) {
      const snippet = request.context.transcript.segments
        .slice(0, 20)
        .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s]: "${s.text}"`)
        .join('\n')
      contextLines.push(`Transcript Excerpt:\n${snippet}`)
    }

    const systemPrompt = buildSystemMessage(contextLines.join('\n'))

    const fullMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...request.messages]

    log.info(`[AIManager] Starting chat with ${provider.displayName}, messages: ${fullMessages.length}`)

    try {
      const stream = provider.chat(fullMessages, ALL_AI_TOOLS, { model: request.model }, signal)

      for await (const chunk of stream) {
        if (signal.aborted) break

        this.emit(win, chunk)

        // Eager tool execution on tool_call_end
        if (chunk.type === 'tool_call_end') {
          const { id, name, arguments: toolArgs } = chunk
          const destructive = isToolDestructive(name)
          const autoApprove = Boolean(request.autoApprove)

          const runExecution = async () => {
            try {
              const result = await executeTool(id, name, toolArgs)
              this.emit(win, {
                type: 'tool_result',
                id,
                name,
                result,
              })
            } catch (toolError) {
              const errMessage = toolError instanceof Error ? toolError.message : String(toolError)
              log.error(`[AIManager] Tool execution failed for ${name}:`, errMessage)
              this.emit(win, {
                type: 'tool_result',
                id,
                name,
                result: null,
                error: errMessage,
              })
            }
          }

          if (destructive && !autoApprove) {
            log.info(`[AIManager] Destructive tool ${name} requires approval. Prompting user.`)
            this.emit(win, {
              type: 'approval_required',
              id,
              name,
              arguments: toolArgs,
              summary: `Ed wants to execute ${name} with ${JSON.stringify(toolArgs)}`,
            })

            const approved = await new Promise<boolean>((resolve) => {
              this.pendingApprovals.set(id, {
                toolCallId: id,
                name,
                args: toolArgs,
                resolve,
              })
            })

            if (approved) {
              await runExecution()
            } else {
              log.info(`[AIManager] Destructive tool ${name} was rejected by user.`)
              this.emit(win, {
                type: 'tool_result',
                id,
                name,
                result: null,
                error: 'Action cancelled by user.',
              })
            }
          } else {
            // Eagerly execute non-destructive or auto-approved tool
            await runExecution()
          }
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        log.error('[AIManager] Chat streaming error:', message)
        this.emit(win, { type: 'error', message })
      }
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null
      }
    }
  }
}

export const aiManager = new AIManager()
