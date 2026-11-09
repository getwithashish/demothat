import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log/main'
import { appState } from '../state'
import { isToolDestructive } from './tools'

interface PendingTool {
  id: string
  name: string
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const pendingExecutions = new Map<string, PendingTool>()

function editorWindow(): BrowserWindow | null {
  const win = appState.editorWin
  return win && !win.isDestroyed() ? win : null
}

/**
 * Register handler for when the renderer responds with tool execution outcome.
 */
export function registerToolExecutorIPC(): void {
  ipcMain.on(
    'ai:tool-execution-result',
    (_event, payload: { id: string; ok: boolean; result?: unknown; error?: string }) => {
      const pending = pendingExecutions.get(payload.id)
      if (!pending) return

      clearTimeout(pending.timer)
      pendingExecutions.delete(payload.id)

      if (payload.ok) {
        pending.resolve(payload.result ?? { success: true })
      } else {
        pending.reject(new Error(payload.error ?? `Tool ${pending.name} failed`))
      }
    },
  )
}

/**
 * Executes a tool by sending it to the active editor window's Zustand store,
 * or executing it locally if it's a main-process concern.
 */
export async function executeTool(
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<unknown> {
  const win = editorWindow()
  if (!win) {
    throw new Error('No active editor window to execute editing tools.')
  }

  log.info(`[ToolExecutor] Executing ${name} (id: ${toolCallId}, destructive: ${isToolDestructive(name)})`)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingExecutions.delete(toolCallId)
      reject(new Error(`Tool ${name} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    pendingExecutions.set(toolCallId, {
      id: toolCallId,
      name,
      resolve,
      reject,
      timer,
    })

    win.webContents.send('ai:execute-tool', {
      id: toolCallId,
      name,
      args,
      destructive: isToolDestructive(name),
    })
  })
}
