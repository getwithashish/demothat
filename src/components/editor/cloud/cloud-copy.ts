// Copy for the cloud export surfaces, kept out of the component files so React
// Fast Refresh stays happy (a module must export only components to hot-reload).

/** "about 8 min left", or null when the server has not estimated yet. */
export function etaLabel(etaSeconds: number | null | undefined): string | null {
  if (typeof etaSeconds !== 'number' || !Number.isFinite(etaSeconds) || etaSeconds <= 0) return null
  const minutes = Math.round(etaSeconds / 60)
  if (minutes < 1) return 'less than a minute left'
  return `about ${minutes} min left`
}
