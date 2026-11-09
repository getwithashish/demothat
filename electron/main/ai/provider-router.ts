import type { AIProvider } from './providers/types'
import { ManagedCloudProvider } from './providers/managed-cloud'
import { CustomOpenAIProvider } from './providers/custom-openai'
import { OllamaProvider } from './providers/ollama'
import Store from 'electron-store'

const store = new Store()

export class ProviderRouter {
  private providers = new Map<string, AIProvider>()
  private defaultProviderId = 'managed-cloud'

  constructor() {
    this.register(new ManagedCloudProvider())
    this.register(new CustomOpenAIProvider())
    this.register(new OllamaProvider())
  }

  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider)
  }

  getProvider(providerId?: string): AIProvider {
    // If not explicitly provided, check user's saved preference
    const savedId = (store.get('ai.activeProviderId') as string) || this.defaultProviderId
    const targetId = providerId || savedId
    const provider = this.providers.get(targetId)
    if (!provider) {
      const fallback = this.providers.get(this.defaultProviderId)
      if (!fallback) throw new Error(`No AI provider registered for ID ${targetId}`)
      return fallback
    }
    return provider
  }

  async listProviders(): Promise<Array<{ id: string; name: string; displayName: string; available: boolean }>> {
    const list: Array<{ id: string; name: string; displayName: string; available: boolean }> = []
    for (const p of this.providers.values()) {
      let available = false
      try {
        available = await p.isAvailable()
      } catch {
        available = false
      }
      list.push({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        available,
      })
    }
    return list
  }
}

export const providerRouter = new ProviderRouter()
