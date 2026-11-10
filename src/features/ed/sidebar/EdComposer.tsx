/**
 * Ed Composer — the message input area at the bottom of the sidebar.
 *
 * Features:
 * - Auto-growing textarea (1–6 rows)
 * - Animated border pulse while Ed is streaming
 * - Send↔Stop button morph
 * - Slash command inline menu (/)
 * - Keyboard hints (Enter / Shift+Enter / Ctrl+K)
 * - Auto-approve toggle switch
 * - Respects prefers-reduced-motion
 * - Styled for both Light and Dark modes
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Send, Square, Slash } from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { Switch } from '../../../components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip'
import { ED_ACTIONS, resolvePrompt } from '../actions/registry'
import { useEdContext } from '../hooks/useEdContext'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { cn } from '../../../lib/utils'

function isMac() {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
}

interface EdComposerProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
}

export function EdComposer({ onSend, onStop, isStreaming, disabled }: EdComposerProps) {
  const reduced = useReducedMotion()
  const ctx = useEdContext()
  const [input, setInput] = useState('')
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoApproveAI = useEditorStore((s) => s.autoApproveAI)
  const setAutoApproveAI = useEditorStore((s) => s.setAutoApproveAI)

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lineH = 20
    const maxH = lineH * 6 + 16
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px'
  }, [input])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    if (val === '/') {
      setShowSlashMenu(true)
      setSlashQuery('')
      setSlashIndex(0)
    } else if (val.startsWith('/') && !val.includes(' ')) {
      setShowSlashMenu(true)
      setSlashQuery(val.slice(1).toLowerCase())
      setSlashIndex(0)
    } else {
      setShowSlashMenu(false)
    }
  }, [])

  const slashActions = useMemo(() => {
    if (!showSlashMenu) return []
    return ED_ACTIONS.filter(
      (a) =>
        a.id !== 'wand-custom' &&
        (slashQuery === '' ||
          a.title.toLowerCase().includes(slashQuery) ||
          a.keywords.some((k) => k.includes(slashQuery))),
    ).slice(0, 6)
  }, [showSlashMenu, slashQuery])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashMenu) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashIndex((i) => Math.min(i + 1, slashActions.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashIndex((i) => Math.max(i - 1, 0))
          return
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault()
          const action = slashActions[slashIndex]
          if (action) {
            const prompt = resolvePrompt(action, ctx)
            setInput(prompt)
            setShowSlashMenu(false)
          }
          return
        }
        if (e.key === 'Escape') {
          setShowSlashMenu(false)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (input.trim() && !isStreaming && !disabled) {
          onSend(input.trim())
          setInput('')
          setShowSlashMenu(false)
        }
      }
    },
    [showSlashMenu, slashActions, slashIndex, ctx, input, isStreaming, disabled, onSend],
  )

  const handleSend = useCallback(() => {
    if (input.trim() && !isStreaming && !disabled) {
      onSend(input.trim())
      setInput('')
      setShowSlashMenu(false)
    }
  }, [input, isStreaming, disabled, onSend])

  const fillFromSlash = useCallback((prompt: string) => {
    setInput(prompt)
    setShowSlashMenu(false)
    textareaRef.current?.focus()
  }, [])

  const modKey = isMac() ? '⌘' : 'Ctrl'

  return (
    <div className="border-t border-line/60 p-3 bg-panel">
      {/* Animated border while streaming */}
      <motion.div
        className="relative rounded-xl border border-line bg-ctl/40 overflow-hidden"
        animate={
          !reduced && isStreaming
            ? {
                borderColor: ['var(--sa-line)', 'var(--sa-accent)', 'var(--sa-line)'],
              }
            : {
                borderColor: 'var(--sa-line)',
              }
        }
        style={{
          outline: 'none',
        }}
        transition={isStreaming ? { repeat: Infinity, duration: 1.8, ease: 'easeInOut' } : { duration: 0.3 }}
      >
        {/* Slash command menu */}
        <AnimatePresence>
          {showSlashMenu && slashActions.length > 0 && (
            <motion.div
              className="absolute bottom-full left-0 right-0 mb-1 z-10 overflow-hidden rounded-xl border border-line bg-panel shadow-lg"
              initial={reduced ? {} : { opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? {} : { opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              <div className="px-2 py-1.5 border-b border-line">
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <Slash size={11} />
                  Slash commands
                </span>
              </div>
              {slashActions.map((action, i) => {
                const Icon = action.icon
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors',
                      i === slashIndex ? 'bg-ctl/80 text-fg' : 'text-fg/80 hover:bg-ctl/50',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      fillFromSlash(resolvePrompt(action, ctx))
                    }}
                  >
                    <Icon size={13} className="text-muted shrink-0" />
                    <span className="font-medium">{action.title}</span>
                    <span className="ml-auto text-[11px] text-muted truncate">{action.description}</span>
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Ask Ed anything or type / for commands…"
          className={cn(
            'w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13px] text-fg',
            'placeholder:text-muted outline-none leading-relaxed',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          style={{ minHeight: '40px', maxHeight: '120px' }}
          aria-label="Message to Ed"
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-2.5 pb-2 pt-1">
          <div className="flex items-center gap-3">
            {/* Auto-approve toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <Switch
                    checked={autoApproveAI}
                    onCheckedChange={setAutoApproveAI}
                    className="scale-75 origin-left"
                    aria-label="Auto-approve AI actions"
                  />
                  <span className="text-[11px] text-muted font-medium">Auto</span>
                </label>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                {autoApproveAI
                  ? 'Auto-approve ON: Ed applies edits immediately. Undo anytime with Ctrl/Cmd+Z.'
                  : 'Auto-approve OFF: Ed will ask before destructive changes.'}
              </TooltipContent>
            </Tooltip>

            <span className="text-[11px] text-muted select-none">
              <span className="font-mono">↵</span> send
              <span className="mx-1 opacity-40">·</span>
              <span className="font-mono">⇧↵</span> newline
              <span className="mx-1 opacity-40">·</span>
              <span className="font-mono">{modKey}K</span>
            </span>
          </div>

          {/* Send / Stop button */}
          <AnimatePresence mode="wait">
            {isStreaming ? (
              <motion.button
                key="stop"
                type="button"
                onClick={onStop}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                initial={reduced ? {} : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={reduced ? {} : { scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                aria-label="Stop Ed"
                title="Stop Ed"
              >
                <Square size={12} />
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || disabled}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-sm transition-opacity disabled:opacity-35 hover:opacity-90"
                initial={reduced ? {} : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={reduced ? {} : { scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                aria-label="Send message to Ed"
                title="Send (Enter)"
              >
                <Send size={12} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
