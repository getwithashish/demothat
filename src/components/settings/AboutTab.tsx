import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { BrandGithub } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'

export function AboutTab() {
  const [appVersion, setAppVersion] = useState('...')

  useEffect(() => {
    // Fetch the app version from the main process
    window.electronAPI.getVersion().then((version) => {
      setAppVersion(version)
    })
  }, [])

  const openLink = (url: string) => {
    window.electronAPI.openExternal(url)
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center p-8 text-center">
      <img src="media://demothat-appicon.png" alt="DemoThat logo" className="mb-4 h-24 w-24 rounded-2xl" />
      <h2 className="text-title font-semibold text-fg">DemoThat</h2>
      <p className="mt-0.5 font-mono text-sm text-muted">Version {appVersion}</p>

      <div className="mt-6 space-y-1.5 text-ui text-muted">
        <p>Created with ❤️ by Ashish Sam.</p>
        <p>Based on ScreenArc by Tam Nguyen. Licensed under GPL-3.0.</p>
        <p>A modern screen recorder and editor designed to be simple and powerful.</p>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="secondary" onClick={() => openLink('https://github.com/getwithashish/DemoThat')}>
          <BrandGithub size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
          GitHub Repository
        </Button>
      </div>

      <p className="absolute bottom-4 text-sm text-muted">Built with Electron, React, and TypeScript.</p>
    </div>
  )
}
