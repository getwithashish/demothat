/**
 * EdSidebar — Surface A: dedicated assistant sidebar on the right.
 *
 * Professional, calm layout:
 * - Header: Ed mascot avatar + name + credits pill + clear action
 * - Empty state: 2×2 suggestion cards with hover lift
 * - Message list with spring-in messages and auto-scroll
 * - Action cards via EdActionCard (with undo, show on timeline, details)
 * - Context chips (playhead, selection, clip) throttled to 10 Hz
 * - Auto-growing composer with animated border pulse while streaming
 * - Send↔Stop morph, slash commands, auto-approve toggle
 * - Polished for both Light and Dark themes
 *
 * Preserves all existing hook behavior (useAIChat IPC contract).
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Trash, ChevronDown } from 'tabler-icons-react'
import { useAIChat } from '../../../components/ai/useAIChat'
import { useEditorStore } from '../../../store/editorStore'
import { useEdContext } from '../hooks/useEdContext'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip'
import { EdAvatar } from './EdAvatar'
import { EdCreditsPill } from './EdCreditsPill'
import { EdSuggestionCards } from './EdSuggestionCards'
import { EdContextChips } from './EdContextChips'
import { EdMessageBubble } from './EdMessageBubble'
import { EdComposer } from './EdComposer'

const INITIAL_MESSAGES_TO_SHOW = 1 // greeting

export function EdSidebar() {
  const { messages, isStreaming, pendingApproval, sendPrompt, approveTool, cancelStream, clearChat } = useAIChat()

  const balance = useEditorStore((s) => s.balance)
  const ctx = useEdContext()
  const reduced = useReducedMotion()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Determine if conversation has started (messages beyond the greeting)
  const hasConversation = messages.length > INITIAL_MESSAGES_TO_SHOW

  // Auto-scroll to bottom unless user scrolled up
  useEffect(() => {
    if (!userScrolled) {
      messagesEndRef.current?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' })
    }
  }, [messages, pendingApproval, userScrolled, reduced])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setUserScrolled(!atBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' })
    setUserScrolled(false)
  }, [reduced])

  const handleSend = useCallback(
    (text: string) => {
      sendPrompt(text)
      setUserScrolled(false)
    },
    [sendPrompt],
  )

  const handleFill = useCallback(
    (text: string) => {
      sendPrompt(text)
    },
    [sendPrompt],
  )

  const handleClear = useCallback(() => {
    if (showClearConfirm) {
      clearChat()
      setShowClearConfirm(false)
    } else {
      setShowClearConfirm(true)
      setTimeout(() => setShowClearConfirm(false), 3000)
    }
  }, [clearChat, showClearConfirm])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-panel text-fg select-none overflow-hidden">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <EdAvatar size={28} streaming={isStreaming} />
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-[13px] font-semibold tracking-tight text-fg">Ed</h2>
                <span className="rounded-full bg-ctl px-1.5 py-px text-[11px] font-medium text-muted border border-line/60">
                  Assistant
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <EdCreditsPill balance={typeof balance === 'number' ? balance : undefined} />

            {/* Clear conversation button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-md p-1.5 text-muted transition-colors hover:bg-ctl/70 hover:text-danger"
                  aria-label={showClearConfirm ? 'Click again to confirm' : 'Clear conversation'}
                >
                  <Trash size={15} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {showClearConfirm ? 'Click again to confirm' : 'Clear conversation'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Empty state / Suggestion cards (before conversation starts) ─ */}
        <AnimatePresence>
          {!hasConversation && (
            <motion.div
              className="shrink-0"
              initial={reduced ? {} : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              <div className="px-3.5 pt-3 pb-1">
                <p className="text-[12px] text-muted leading-relaxed">
                  Tell me what to edit — I&apos;ll handle the rest.
                </p>
              </div>
              <EdSuggestionCards ctx={ctx} onSend={handleSend} onFill={handleFill} disabled={isStreaming} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Message list ─────────────────────────────────────────────── */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5"
          role="log"
          aria-label="Ed conversation"
          aria-live="polite"
          aria-atomic="false"
        >
          {messages.map((msg, i) => (
            <EdMessageBubble
              key={msg.id}
              message={msg}
              isStreamingLast={isStreaming && i === messages.length - 1}
              onApprove={(id) => approveTool(id, true)}
              onReject={(id) => approveTool(id, false)}
            />
          ))}

          {/* Approval card — if no tool execution captures it */}
          {pendingApproval &&
            !messages.some((m) => m.toolExecutions?.some((t) => t.id === pendingApproval.toolCallId)) && (
              <ApprovalCard
                pendingApproval={pendingApproval}
                onApprove={(id) => approveTool(id, true)}
                onReject={(id) => approveTool(id, false)}
              />
            )}

          <div ref={messagesEndRef} />
        </div>

        {/* Jump to latest pill */}
        <AnimatePresence>
          {userScrolled && (
            <motion.div
              className="absolute bottom-[140px] right-6 z-10"
              initial={reduced ? {} : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
            >
              <button
                type="button"
                onClick={scrollToBottom}
                className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-[11px] font-medium text-fg shadow-md hover:bg-ctl/70 transition-colors"
              >
                <ChevronDown size={12} />
                Jump to latest
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Context Chips ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-line/50">
          <EdContextChips />
        </div>

        {/* ── Composer ──────────────────────────────────────────────────── */}
        <div className="shrink-0">
          <EdComposer onSend={handleSend} onStop={cancelStream} isStreaming={isStreaming} />
        </div>
      </div>
    </TooltipProvider>
  )
}

function ApprovalCard({
  pendingApproval,
  onApprove,
  onReject,
}: {
  pendingApproval: { toolCallId: string; name: string; args: Record<string, unknown>; summary: string }
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  return (
    <div className="my-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-[12px] font-semibold text-fg">
        {pendingApproval.summary || `Approve: ${pendingApproval.name}`}
      </p>
      <p className="mt-0.5 text-[11px] text-muted">Ed is asking permission to run this action.</p>
      {pendingApproval.args && Object.keys(pendingApproval.args).length > 0 && (
        <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-ctl/50 p-1.5 font-mono text-[11px] text-muted">
          {JSON.stringify(pendingApproval.args, null, 2)}
        </pre>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onReject(pendingApproval.toolCallId)}
          className="flex h-6 items-center gap-1 rounded-md border border-line bg-ctl px-2.5 text-[11px] font-medium text-muted hover:text-fg transition-colors"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => onApprove(pendingApproval.toolCallId)}
          className="flex h-6 items-center gap-1 rounded-md bg-emerald-500 px-3 text-[11px] font-semibold text-white hover:bg-emerald-600 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
