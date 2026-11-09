import { describe, expect, it, vi } from 'vitest'

const storeState = vi.hoisted(() => ({ data: new Map<string, unknown>() }))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string, defaultValue?: unknown) {
      return storeState.data.has(key) ? storeState.data.get(key) : defaultValue
    }
    set(key: string, value: unknown) {
      storeState.data.set(key, value)
    }
  },
}))

vi.mock('electron-log/main', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined },
}))

import { ALL_AI_TOOLS, getToolDefinition, isToolDestructive } from './tools'
import { ProviderRouter } from './provider-router'
import { ManagedCloudProvider } from './providers/managed-cloud'
import { CustomOpenAIProvider } from './providers/custom-openai'
import { OllamaProvider } from './providers/ollama'
import { buildSystemMessage, ED_SYSTEM_PROMPT } from './system-prompt'

describe('AI Tools Catalog', () => {
  it('contains expected core tools', () => {
    const names = ALL_AI_TOOLS.map((t) => t.name)
    expect(names).toContain('add_zoom_region')
    expect(names).toContain('add_cut_region')
    expect(names).toContain('add_speed_region')
    expect(names).toContain('update_region')
    expect(names).toContain('delete_region')
    expect(names).toContain('set_frame_style')
    expect(names).toContain('set_background')
    expect(names).toContain('set_aspect_ratio')
    expect(names).toContain('run_tidy_up')
    expect(names).toContain('run_transcription')
  })

  it('correctly marks destructive tools', () => {
    expect(isToolDestructive('delete_region')).toBe(true)
    expect(isToolDestructive('delete_selected')).toBe(true)
    expect(isToolDestructive('delete_visual_effect')).toBe(true)
    expect(isToolDestructive('remove_subtitle_cue')).toBe(true)
    expect(isToolDestructive('add_zoom_region')).toBe(false)
    expect(isToolDestructive('set_aspect_ratio')).toBe(false)
  })

  it('retrieves tool definitions by name', () => {
    const zoomTool = getToolDefinition('add_zoom_region')
    expect(zoomTool).toBeDefined()
    expect(zoomTool?.parameters.properties).toHaveProperty('startTime')
    expect(zoomTool?.parameters.required).toContain('startTime')
  })
})

describe('ProviderRouter', () => {
  it('registers and retrieves default managed-cloud provider', () => {
    const router = new ProviderRouter()
    const provider = router.getProvider()
    expect(provider.id).toBe('managed-cloud')
    expect(provider.displayName).toContain('DemoThat Cloud')
  })

  it('lists registered providers', async () => {
    const router = new ProviderRouter()
    const list = await router.listProviders()
    expect(list.length).toBeGreaterThanOrEqual(3)
    const ids = list.map((p) => p.id)
    expect(ids).toContain('managed-cloud')
    expect(ids).toContain('custom-openai')
    expect(ids).toContain('ollama')
  })
})

describe('Custom AI Providers', () => {
  it('estimates tokens with CustomOpenAIProvider', () => {
    const provider = new CustomOpenAIProvider()
    const tokens = provider.estimateTokens([{ role: 'user', content: 'Apply zoom effect' }])
    expect(tokens).toBeGreaterThan(0)
  })

  it('estimates tokens with OllamaProvider', () => {
    const provider = new OllamaProvider()
    const tokens = provider.estimateTokens([{ role: 'user', content: 'Cut the first 3 seconds' }])
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('ManagedCloudProvider token estimation', () => {
  it('estimates tokens based on character length', () => {
    const provider = new ManagedCloudProvider()
    const tokens = provider.estimateTokens([
      { role: 'user', content: 'Short message' },
      { role: 'assistant', content: 'Another short response from Ed' },
    ])
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('Ed Persona System Prompt', () => {
  it('contains Ed name and core video editing instructions', () => {
    expect(ED_SYSTEM_PROMPT).toContain('Ed')
    expect(ED_SYSTEM_PROMPT).toContain('DemoThat')
    expect(ED_SYSTEM_PROMPT).toContain('add_zoom_region')
  })

  it('appends project context when provided', () => {
    const prompt = buildSystemMessage('Timeline Duration: 120s')
    expect(prompt).toContain(ED_SYSTEM_PROMPT)
    expect(prompt).toContain('Project Context:')
    expect(prompt).toContain('Timeline Duration: 120s')
  })
})
