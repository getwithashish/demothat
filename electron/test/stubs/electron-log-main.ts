// Test stub: electron-log/main and electron-log/renderer routes to console so unit tests don't boot Electron.

interface TransportConfig {
  level?: string | boolean
  format?: string | ((...args: unknown[]) => unknown)
  maxSize?: number
  archiveLogFn?: (file: unknown) => void
}

const transports = {
  console: { level: 'silly', format: '' } as TransportConfig,
  file: { level: 'silly', format: '', maxSize: 1048576 } as TransportConfig,
  ipc: undefined,
  remote: { level: false } as TransportConfig,
}

const createLogger = (scopeName?: string) => {
  const prefix = scopeName ? `[log:${scopeName}]` : '[log]'
  const loggerInstance = {
    info: (...args: unknown[]) => console.info(`${prefix}:info`, ...args),
    warn: (...args: unknown[]) => console.warn(`${prefix}:warn`, ...args),
    error: (...args: unknown[]) => console.error(`${prefix}:error`, ...args),
    debug: (...args: unknown[]) => console.debug(`${prefix}:debug`, ...args),
    verbose: (...args: unknown[]) => console.log(`${prefix}:verbose`, ...args),
    silly: (...args: unknown[]) => console.debug(`${prefix}:silly`, ...args),
    log: (...args: unknown[]) => console.log(`${prefix}:log`, ...args),
    scope: (name: string) => createLogger(name),
    initialize: () => {},
    transports,
  }
  return loggerInstance
}

const log = createLogger()

export default log
