import { useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { Section } from '../ui/section'
import { ToggleRow } from '../ui/toggle-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { PanelHeader } from '../editor/PanelHeader'
import { useShallow } from 'zustand/react/shallow'

interface ProviderItem {
  id: string
  name: string
  displayName: string
  available: boolean
}

export function AITab() {
  const { autoApproveAI, setAutoApproveAI, aiPinned, setAiPinned } = useEditorStore(
    useShallow((state) => ({
      autoApproveAI: state.autoApproveAI,
      setAutoApproveAI: state.setAutoApproveAI,
      aiPinned: state.aiPinned,
      setAiPinned: state.setAiPinned,
    })),
  )

  const [activeProviderId, setActiveProviderId] = useState<string>('managed-cloud')
  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [openaiKey, setOpenaiKey] = useState<string>('')
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState<string>('https://api.openai.com/v1')
  const [openaiModel, setOpenaiModel] = useState<string>('gpt-4o-mini')
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>('http://127.0.0.1:11434')
  const [ollamaModel, setOllamaModel] = useState<string>('llama3.2')
  const [savedStatus, setSavedStatus] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        if (window.electronAPI?.aiGetProviders) {
          const list = await window.electronAPI.aiGetProviders()
          if (mounted) setProviders(list as ProviderItem[])
        }
        if (window.electronAPI?.getSetting) {
          const savedId = (await window.electronAPI.getSetting('ai.activeProviderId')) as string
          if (savedId && mounted) setActiveProviderId(savedId)

          const key = (await window.electronAPI.getSetting('ai.customOpenai.apiKey')) as string
          if (key && mounted) setOpenaiKey(key)

          const obUrl = (await window.electronAPI.getSetting('ai.customOpenai.baseUrl')) as string
          if (obUrl && mounted) setOpenaiBaseUrl(obUrl)

          const om = (await window.electronAPI.getSetting('ai.customOpenai.model')) as string
          if (om && mounted) setOpenaiModel(om)

          const olUrl = (await window.electronAPI.getSetting('ai.ollama.baseUrl')) as string
          if (olUrl && mounted) setOllamaBaseUrl(olUrl)

          const olm = (await window.electronAPI.getSetting('ai.ollama.model')) as string
          if (olm && mounted) setOllamaModel(olm)
        }
      } catch {
        // Fallback gracefully
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const handleProviderChange = (newId: string) => {
    setActiveProviderId(newId)
    window.electronAPI?.setSetting('ai.activeProviderId', newId)
    triggerSavedFeedback()
  }

  const triggerSavedFeedback = () => {
    setSavedStatus('Settings saved')
    setTimeout(() => setSavedStatus(null), 2000)
  }

  const handleSaveOpenAI = () => {
    window.electronAPI?.setSetting('ai.customOpenai.apiKey', openaiKey)
    window.electronAPI?.setSetting('ai.customOpenai.baseUrl', openaiBaseUrl)
    window.electronAPI?.setSetting('ai.customOpenai.model', openaiModel)
    triggerSavedFeedback()
  }

  const handleSaveOllama = () => {
    window.electronAPI?.setSetting('ai.ollama.baseUrl', ollamaBaseUrl)
    window.electronAPI?.setSetting('ai.ollama.model', ollamaModel)
    triggerSavedFeedback()
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="AI Assistant" subtitle="Ed Persona & Providers" />
      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first label="Provider">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-ui text-fg">Active Provider</div>
                <p className="text-sm text-muted">Choose DemoThat Cloud (default) or connect your own models.</p>
              </div>
              <div className="w-52">
                <Select value={activeProviderId} onValueChange={handleProviderChange}>
                  <SelectTrigger aria-label="Active AI Provider">
                    <SelectValue placeholder="Select Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.length > 0 ? (
                      providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.displayName} {p.available ? '✓' : ''}
                        </SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="managed-cloud">DemoThat Cloud (Ed)</SelectItem>
                        <SelectItem value="custom-openai">Custom OpenAI / API</SelectItem>
                        <SelectItem value="ollama">Local Ollama</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Provider specific inputs */}
            {activeProviderId === 'managed-cloud' && (
              <div className="rounded-md border border-line/60 bg-ctl/20 p-3 text-xs text-muted space-y-1">
                <div className="font-medium text-fg">Managed Cloud Service</div>
                <p>
                  Powered by DemoThat Cloud. Uses your account cloud credits ($30 per million tokens, metered per tool
                  call).
                </p>
              </div>
            )}

            {activeProviderId === 'custom-openai' && (
              <div className="space-y-3 rounded-md border border-line bg-ctl/30 p-3 text-xs">
                <div>
                  <label className="block text-ui text-fg mb-1">OpenAI API Key</label>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    onBlur={handleSaveOpenAI}
                    className="w-full rounded border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-ui text-fg mb-1">Base URL</label>
                  <input
                    type="text"
                    placeholder="https://api.openai.com/v1"
                    value={openaiBaseUrl}
                    onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                    onBlur={handleSaveOpenAI}
                    className="w-full rounded border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-muted">Compatible with OpenAI, Groq, OpenRouter, vLLM.</span>
                </div>
                <div>
                  <label className="block text-ui text-fg mb-1">Model Name</label>
                  <input
                    type="text"
                    placeholder="gpt-4o-mini"
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    onBlur={handleSaveOpenAI}
                    className="w-full rounded border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}

            {activeProviderId === 'ollama' && (
              <div className="space-y-3 rounded-md border border-line bg-ctl/30 p-3 text-xs">
                <div>
                  <label className="block text-ui text-fg mb-1">Ollama Host URL</label>
                  <input
                    type="text"
                    placeholder="http://127.0.0.1:11434"
                    value={ollamaBaseUrl}
                    onChange={(e) => setOllamaBaseUrl(e.target.value)}
                    onBlur={handleSaveOllama}
                    className="w-full rounded border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[11px] text-muted">Run Ollama locally for 100% private, offline editing.</span>
                </div>
                <div>
                  <label className="block text-ui text-fg mb-1">Model Tag</label>
                  <input
                    type="text"
                    placeholder="llama3.2"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    onBlur={handleSaveOllama}
                    className="w-full rounded border border-line bg-bg px-2.5 py-1.5 text-xs text-fg focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section label="Automation & Interaction">
          <div className="space-y-3.5">
            <ToggleRow
              id="ai-auto-approve"
              label="Auto-approve destructive edits"
              description="When enabled, Ed will execute delete and cut actions without asking for step-by-step confirmation."
              checked={autoApproveAI}
              onCheckedChange={setAutoApproveAI}
            />
            <ToggleRow
              id="ai-pinned"
              label="Keep Ed pinned to the editor"
              description="Keep the AI panel open as a persistent right-hand column alongside your timeline."
              checked={aiPinned}
              onCheckedChange={setAiPinned}
            />
          </div>
        </Section>

        <Section label="Persona & Shortcuts">
          <div className="space-y-2 text-xs text-muted">
            <p>
              <strong className="text-fg">Ed</strong> is your enthusiastic, witty, and precise video editing partner.
            </p>
            <p>
              Press <kbd className="rounded bg-ctl px-1.5 py-0.5 text-[11px] text-fg font-mono">Cmd + K</kbd> or{' '}
              <kbd className="rounded bg-ctl px-1.5 py-0.5 text-[11px] text-fg font-mono">Ctrl + K</kbd> anywhere in the
              editor for quick commands.
            </p>
            {savedStatus && <p className="text-xs font-semibold text-emerald-400">{savedStatus}</p>}
          </div>
        </Section>
      </div>
    </div>
  )
}
