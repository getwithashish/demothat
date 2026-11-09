import { useState, useEffect, useCallback, useRef } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { ChatMessage, ChatChunk, AIProjectContext } from '../../../shared/ai-types'

export interface ToolCallState {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'success' | 'error' | 'pending_approval'
  result?: unknown
  error?: string
}

export interface DisplayMessage extends ChatMessage {
  id: string
  toolExecutions?: ToolCallState[]
}

export function useAIChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'initial-greeting',
      role: 'assistant',
      content:
        "Hey! I'm Ed, your editing assistant. Tell me what you'd like to do — speed up silences, zoom in on an action, change styles, or cut segments. I'm ready!",
    },
  ])
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<{
    toolCallId: string
    name: string
    args: Record<string, unknown>
    summary: string
  } | null>(null)

  const autoApproveAI = useEditorStore((state) => state.autoApproveAI)
  const setAutoApproveAI = useEditorStore((state) => state.setAutoApproveAI)

  const activeAssistantMsgIdRef = useRef<string | null>(null)

  // Listen to IPC chunks
  useEffect(() => {
    const unsubscribe = window.electronAPI.onAIChunk((chunk: ChatChunk) => {
      switch (chunk.type) {
        case 'text': {
          setMessages((prev) => {
            const currentId = activeAssistantMsgIdRef.current
            if (!currentId) return prev
            return prev.map((msg) =>
              msg.id === currentId ? { ...msg, content: (msg.content || '') + chunk.delta } : msg,
            )
          })
          break
        }

        case 'tool_call_start': {
          setMessages((prev) => {
            const currentId = activeAssistantMsgIdRef.current
            if (!currentId) return prev
            return prev.map((msg) => {
              if (msg.id !== currentId) return msg
              const executions = msg.toolExecutions || []
              return {
                ...msg,
                toolExecutions: [
                  ...executions,
                  {
                    id: chunk.id,
                    name: chunk.name,
                    args: {},
                    status: 'running',
                  },
                ],
              }
            })
          })
          break
        }

        case 'tool_call_end': {
          setMessages((prev) => {
            const currentId = activeAssistantMsgIdRef.current
            if (!currentId) return prev
            return prev.map((msg) => {
              if (msg.id !== currentId) return msg
              const executions = (msg.toolExecutions || []).map((t) =>
                t.id === chunk.id ? { ...t, args: chunk.arguments } : t,
              )
              return { ...msg, toolExecutions: executions }
            })
          })
          break
        }

        case 'approval_required': {
          setPendingApproval({
            toolCallId: chunk.id,
            name: chunk.name,
            args: chunk.arguments,
            summary: chunk.summary,
          })
          setMessages((prev) => {
            const currentId = activeAssistantMsgIdRef.current
            if (!currentId) return prev
            return prev.map((msg) => {
              if (msg.id !== currentId) return msg
              const executions = (msg.toolExecutions || []).map((t) =>
                t.id === chunk.id ? { ...t, status: 'pending_approval' as const } : t,
              )
              return { ...msg, toolExecutions: executions }
            })
          })
          break
        }

        case 'tool_result': {
          setMessages((prev) => {
            const currentId = activeAssistantMsgIdRef.current
            if (!currentId) return prev
            return prev.map((msg) => {
              if (msg.id !== currentId) return msg
              const executions = (msg.toolExecutions || []).map((t) =>
                t.id === chunk.id
                  ? {
                      ...t,
                      status: (chunk.error ? 'error' : 'success') as 'error' | 'success',
                      result: chunk.result,
                      error: chunk.error,
                    }
                  : t,
              )
              return { ...msg, toolExecutions: executions }
            })
          })
          break
        }

        case 'done': {
          setIsStreaming(false)
          activeAssistantMsgIdRef.current = null
          break
        }

        case 'error': {
          setIsStreaming(false)
          activeAssistantMsgIdRef.current = null
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: `⚠️ ${chunk.message}`,
            },
          ])
          break
        }
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const buildContextSnapshot = useCallback((): AIProjectContext => {
    const store = useEditorStore.getState()
    const {
      duration,
      currentTime,
      selectedRegionId,
      aspectRatio,
      frameStyles,
      cursorStyles,
      zoomRegions,
      cutRegions,
      speedRegions,
      videoClips,
      audioClips,
      subtitleCues,
      cameraMotions,
      visualEffects,
      compositionLayouts,
      metadata,
      transcript,
    } = store

    let selectedRegionType: string | null = null
    let selectedRegionDetails: Record<string, unknown> | null = null

    if (selectedRegionId) {
      if (zoomRegions[selectedRegionId]) {
        selectedRegionType = 'zoom'
        selectedRegionDetails = zoomRegions[selectedRegionId] as unknown as Record<string, unknown>
      } else if (cutRegions[selectedRegionId]) {
        selectedRegionType = 'cut'
        selectedRegionDetails = cutRegions[selectedRegionId] as unknown as Record<string, unknown>
      } else if (speedRegions[selectedRegionId]) {
        selectedRegionType = 'speed'
        selectedRegionDetails = speedRegions[selectedRegionId] as unknown as Record<string, unknown>
      }
    }

    return {
      duration,
      currentTime,
      selectedRegionId,
      selectedRegionType,
      selectedRegionDetails,
      aspectRatio,
      frameStyles: frameStyles as unknown as Record<string, unknown>,
      cursorStyles: cursorStyles as unknown as Record<string, unknown>,
      timelineSummary: {
        zoomRegionsCount: Object.keys(zoomRegions).length,
        cutRegionsCount: Object.keys(cutRegions).length,
        speedRegionsCount: Object.keys(speedRegions).length,
        videoClipsCount: videoClips.length,
        audioClipsCount: audioClips.length,
        subtitleCuesCount: subtitleCues.length,
        cameraMotionsCount: cameraMotions.length,
        visualEffectsCount: visualEffects.length,
        compositionLayoutsCount: compositionLayouts.length,
      },
      zoomRegions: Object.values(zoomRegions).map((z) => ({
        id: z.id,
        startTime: z.startTime,
        duration: z.duration,
        zoomLevel: z.zoomLevel,
        targetX: z.targetX,
        targetY: z.targetY,
        mode: z.mode,
      })),
      cutRegions: Object.values(cutRegions).map((c) => ({
        id: c.id,
        startTime: c.startTime,
        duration: c.duration,
        trimType: c.trimType,
      })),
      speedRegions: Object.values(speedRegions).map((s) => ({
        id: s.id,
        startTime: s.startTime,
        duration: s.duration,
        speed: s.speed,
      })),
      transcript,
      subtitleCues,
      recentClicks: metadata
        .filter((m) => m.type === 'click')
        .slice(-10)
        .map((c) => ({
          timestamp: c.timestamp,
          x: c.x,
          y: c.y,
          button: c.button,
        })),
    }
  }, [])

  const sendPrompt = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      const userMsgId = `user-${Date.now()}`
      const assistantMsgId = `asst-${Date.now()}`
      activeAssistantMsgIdRef.current = assistantMsgId

      const userMessage: DisplayMessage = {
        id: userMsgId,
        role: 'user',
        content: text.trim(),
      }

      const assistantPlaceholder: DisplayMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        toolExecutions: [],
      }

      const updated = [...messages, userMessage]
      setMessages([...updated, assistantPlaceholder])
      setIsStreaming(true)

      const context = buildContextSnapshot()

      try {
        await window.electronAPI.aiChat({
          messages: updated.map(({ role, content }) => ({ role, content })),
          context,
          autoApprove: autoApproveAI,
        })
      } catch (err) {
        setIsStreaming(false)
        activeAssistantMsgIdRef.current = null
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: `Failed to connect with Ed: ${(err as Error)?.message || String(err)}`,
          },
        ])
      }
    },
    [isStreaming, messages, autoApproveAI, buildContextSnapshot],
  )

  const approveTool = useCallback((toolCallId: string, approved: boolean) => {
    window.electronAPI.aiApproveTool({ toolCallId, approved })
    setPendingApproval(null)
  }, [])

  const cancelStream = useCallback(() => {
    window.electronAPI.aiCancel()
    setIsStreaming(false)
    activeAssistantMsgIdRef.current = null
  }, [])

  const clearChat = useCallback(() => {
    setMessages([
      {
        id: 'initial-greeting',
        role: 'assistant',
        content: "Cleared! What's next on our editing agenda?",
      },
    ])
  }, [])

  return {
    messages,
    isStreaming,
    pendingApproval,
    autoApproveAI,
    setAutoApproveAI,
    sendPrompt,
    approveTool,
    cancelStream,
    clearChat,
  }
}
