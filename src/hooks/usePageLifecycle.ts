import { useEffect } from 'react'
import { createScopedLogger } from '../lib/logger'

export function usePageLifecycle(pageName: string) {
  useEffect(() => {
    const logger = createScopedLogger(pageName)
    logger.info('Page mounted')

    const handleFocus = () => logger.info('Window active (focused)')
    const handleBlur = () => logger.info('Window inactive (blurred)')
    const handleVisibilityChange = () => {
      logger.info(`Document visibility state changed: ${document.visibilityState}`)
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      logger.info('Page unmounted')
    }
  }, [pageName])
}
