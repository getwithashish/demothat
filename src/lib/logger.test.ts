import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createScopedLogger, logger } from './logger'

describe('renderer logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('provides default logger with standard methods', () => {
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.verbose).toBe('function')
  })

  it('creates scoped loggers that fallback to console in test environment', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const customLogger = createScopedLogger('audio-ui')

    customLogger.info('audio track initialized', 44100)
    expect(infoSpy).toHaveBeenCalledWith('[audio-ui]', 'audio track initialized', 44100)

    customLogger.debug('buffer details', { size: 1024 })
    expect(debugSpy).toHaveBeenCalledWith('[audio-ui]', 'buffer details', { size: 1024 })

    customLogger.warn('clipping detected')
    expect(warnSpy).toHaveBeenCalledWith('[audio-ui]', 'clipping detected')

    customLogger.error('device failure', new Error('test'))
    expect(errorSpy).toHaveBeenCalledWith('[audio-ui]', 'device failure', expect.any(Error))

    customLogger.verbose('quantum sample')
    expect(debugSpy).toHaveBeenCalledWith('[audio-ui]', 'quantum sample')
  })
})
