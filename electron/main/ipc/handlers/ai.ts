import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AIChatRequest, AIApprovalDecision } from '../../../../shared/ai-types'
import { aiManager } from '../../ai/ai-manager'
import { providerRouter } from '../../ai/provider-router'
import { registerToolExecutorIPC } from '../../ai/tool-executor'

export function registerAiHandlers(): void {
  registerToolExecutorIPC()

  ipcMain.handle('ai:chat', async (event: IpcMainInvokeEvent, request: AIChatRequest) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await aiManager.runChat(win, request)
    return { ok: true }
  })

  ipcMain.on('ai:cancel', () => {
    aiManager.cancel()
  })

  ipcMain.on('ai:approve-tool', (_event, decision: AIApprovalDecision) => {
    aiManager.handleApprovalDecision(decision.toolCallId, decision.approved)
  })

  ipcMain.handle('ai:providers', () => {
    return providerRouter.listProviders()
  })
}
