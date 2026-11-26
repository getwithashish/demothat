// Test stub for electron-updater so plain-Node Vitest tests don't attempt to
// boot the real updater (which calls app.getVersion() at module load time).
// Tests that need updater behaviour should mock this module themselves.

export const autoUpdater = {
  logger: null as unknown,
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowPrerelease: false,
  on: () => autoUpdater,
  removeListener: () => autoUpdater,
  checkForUpdates: () => Promise.resolve(null),
  quitAndInstall: () => {},
}
