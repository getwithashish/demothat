// Audio & Music panel: import, per-clip mixing, mouse click sounds, the
// recording's own audio, and pause review.
// Flat Sections on the shared primitives — no Collapsible, no card-in-card.
import { useMemo, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { useShallow } from 'zustand/react/shallow'
import { Loader2, Scissors, Trash, Upload } from 'tabler-icons-react'
import { Button } from '../../ui/button'
import { HelperText } from '../../ui/helper-text'
import { Section, SectionLabel } from '../../ui/section'
import { SegmentedControl } from '../../ui/segmented-control'
import { Slider } from '../../ui/slider'
import { ToggleRow } from '../../ui/toggle-row'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { formatTime } from '../../../lib/utils'
import { DEFAULTS } from '../../../lib/constants'
import { PanelHeader } from '../PanelHeader'

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-label={`Reset ${label}`}>
      Reset
    </Button>
  )
}

export function AudioSettings() {
  const [isImporting, setIsImporting] = useState(false)
  const [isAnalyzingSilence, setIsAnalyzingSilence] = useState(false)
  const [silenceSuggestions, setSilenceSuggestions] = useState<{ start: number; end: number; duration: number }[]>([])
  const [dismissedSilences, setDismissedSilences] = useState<number[]>([])
  const {
    volume, isMuted, setVolume, setIsMuted, hasAudioTrack, duration, currentTime, videoPath,
    audioClips, selectedRegionId, addAudioClip, updateAudioClip, deleteAudioClip, addCutRegion,
    mouseClickSoundsEnabled, setMouseClickSoundsEnabled, mouseClickSoundPath, mouseClickSoundName,
    setMouseClickSound, mouseClickSoundVolume, setMouseClickSoundVolume,
  } = useEditorStore(useShallow((state) => ({
    volume: state.volume, isMuted: state.isMuted, setVolume: state.setVolume, setIsMuted: state.setIsMuted,
    hasAudioTrack: state.hasAudioTrack, duration: state.duration, currentTime: state.currentTime, videoPath: state.videoPath,
    audioClips: state.audioClips, selectedRegionId: state.selectedRegionId, addAudioClip: state.addAudioClip,
    updateAudioClip: state.updateAudioClip, deleteAudioClip: state.deleteAudioClip, addCutRegion: state.addCutRegion,
    mouseClickSoundsEnabled: state.mouseClickSoundsEnabled, setMouseClickSoundsEnabled: state.setMouseClickSoundsEnabled,
    mouseClickSoundPath: state.mouseClickSoundPath, mouseClickSoundName: state.mouseClickSoundName,
    setMouseClickSound: state.setMouseClickSound, mouseClickSoundVolume: state.mouseClickSoundVolume, setMouseClickSoundVolume: state.setMouseClickSoundVolume,
  })))
  const selectedClip = useMemo(() => audioClips.find((clip) => clip.id === selectedRegionId && clip.kind !== 'click') ?? null, [audioClips, selectedRegionId])
  const selectedClickClip = useMemo(() => audioClips.find((clip) => clip.id === selectedRegionId && clip.kind === 'click') ?? null, [audioClips, selectedRegionId])
  const musicClips = useMemo(() => audioClips.filter((clip) => clip.kind !== 'click'), [audioClips])
  const clickClips = useMemo(() => audioClips.filter((clip) => clip.kind === 'click'), [audioClips])
  const visibleSilences = useMemo(() => silenceSuggestions.filter((item) => !dismissedSilences.includes(item.start)), [silenceSuggestions, dismissedSilences])

  const analyzeSilence = async () => {
    if (!videoPath) return
    setIsAnalyzingSilence(true)
    try {
      const results = await window.electronAPI.detectSilence(videoPath)
      setSilenceSuggestions(results)
      setDismissedSilences([])
      if (results.length === 0) window.electronAPI.showMessageBox({ type: 'info', title: 'Silence review', message: 'No pauses longer than 0.45 seconds were detected at the current threshold.' })
    } catch (error) {
      window.electronAPI.showMessageBox({ type: 'error', title: 'Silence analysis failed', message: error instanceof Error ? error.message : 'Could not analyze the recording audio.' })
    } finally {
      setIsAnalyzingSilence(false)
    }
  }

  const importAudio = async () => {
    setIsImporting(true)
    try {
      const result = await window.electronAPI.openAudioFile()
      if (result.canceled || !result.filePath) return
      const path = result.filePath
      const audio = new Audio(`media://${encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')}`)
      audio.preload = 'metadata'
      await new Promise<void>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve()
        audio.onerror = () => reject(new Error('Could not read audio metadata for this file.'))
        audio.load()
      })
      const fileDuration = Number.isFinite(audio.duration) ? audio.duration : 0
      if (fileDuration <= 0) throw new Error('This audio file has no readable duration.')
      const startTime = Math.min(currentTime, Math.max(0, duration - 0.1))
      const clipDuration = Math.max(0.1, Math.min(fileDuration, duration > 0 ? duration - startTime : fileDuration))
      addAudioClip({
        name: result.fileName || path.split(/[\\/]/).pop() || 'Audio track', filePath: path, startTime, duration: clipDuration,
        sourceStart: 0, sourceDuration: fileDuration, volume: 1, fadeIn: 0, fadeOut: 0, loop: false, kind: 'music', speed: 1,
      })
    } catch (error) {
      console.error('Failed to import audio:', error)
      window.electronAPI.showMessageBox({ type: 'error', title: 'Audio import failed', message: error instanceof Error ? error.message : 'Could not import audio.' })
    } finally {
      setIsImporting(false)
    }
  }

  const importClickSound = async () => {
    const result = await window.electronAPI.openAudioFile()
    if (!result.canceled && result.filePath) setMouseClickSound(result.filePath, result.fileName || result.filePath.split(/[\\/]/).pop() || 'Custom click sound')
  }

  const handleResetVolume = () => { setVolume(DEFAULTS.AUDIO.VOLUME.defaultValue); setIsMuted(DEFAULTS.AUDIO.MUTED.defaultValue) }
  const handleResetClipMix = () => {
    if (selectedClip) updateAudioClip(selectedClip.id, { volume: 1, fadeIn: 0, fadeOut: 0, loop: false })
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Audio & Music" subtitle="Import, trim, loop and mix" />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first>
          <Button className="w-full" onClick={importAudio} disabled={isImporting}>
            {isImporting ? (
              <>
                <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Upload size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                Import audio file
              </>
            )}
          </Button>
          {!selectedClip && !selectedClickClip && (
            <HelperText>Select a music clip on the timeline to edit its volume, trim, speed, loop and fades.</HelperText>
          )}
        </Section>

        {selectedClickClip && (
          <Section
            label="Selected click sound"
            labelRight={<span className="font-mono text-sm tabular-nums text-muted">{formatTime(selectedClickClip.startTime)}</span>}
          >
            <div className="space-y-3.5">
              <HelperText className="mt-0">
                This click is an independent timeline clip. Move it in the timeline or delete it without affecting other
                clicks.
              </HelperText>
              <Slider
                label="Click clip volume"
                min={0}
                max={1}
                step={0.05}
                value={selectedClickClip.volume}
                onChange={(value) => updateAudioClip(selectedClickClip.id, { volume: value })}
                formatValue={(value) => `${value.toFixed(2)}\u00d7`}
              />
              <div className="text-sm text-muted">Position {formatTime(selectedClickClip.startTime)}</div>
              <Button variant="danger" className="w-full" onClick={() => deleteAudioClip(selectedClickClip.id)}>
                <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                Delete this click
              </Button>
            </div>
          </Section>
        )}

        {selectedClip && (
          <Section
            label="Selected music clip"
            labelRight={<ResetButton onClick={handleResetClipMix} label="music clip mix" />}
          >
            <div className="space-y-3.5">
              <div className="truncate text-sm text-fg" title={selectedClip.name}>{selectedClip.name}</div>
              <HelperText className="mt-0">
                Move or trim the clip directly in the timeline. These controls adjust its mix and playback.
              </HelperText>
              <Slider
                label="Clip volume"
                min={0}
                max={1}
                step={0.05}
                value={selectedClip.volume}
                onChange={(value) => updateAudioClip(selectedClip.id, { volume: value })}
                formatValue={(value) => `${value.toFixed(2)}\u00d7`}
              />
              <Slider
                label="Playback speed"
                min={0.5}
                max={2}
                step={0.05}
                value={selectedClip.speed ?? 1}
                onChange={(value) => updateAudioClip(selectedClip.id, { speed: value, duration: Math.max(0.1, Math.min(duration - selectedClip.startTime, selectedClip.duration * (selectedClip.speed ?? 1) / value)) })}
                formatValue={(value) => `${value.toFixed(2)}\u00d7`}
              />
              <Slider
                label="Clip duration"
                min={0.1}
                max={Math.max(0.1, duration - selectedClip.startTime)}
                step={0.1}
                value={selectedClip.duration}
                onChange={(value) => updateAudioClip(selectedClip.id, { duration: value })}
                formatValue={(value) => `${value.toFixed(1)} s`}
              />
              <Slider
                label="Fade in"
                min={0}
                max={Math.min(10, selectedClip.duration)}
                step={0.1}
                value={selectedClip.fadeIn}
                onChange={(value) => updateAudioClip(selectedClip.id, { fadeIn: value })}
                formatValue={(value) => `${value.toFixed(1)} s`}
              />
              <Slider
                label="Fade out"
                min={0}
                max={Math.min(10, selectedClip.duration)}
                step={0.1}
                value={selectedClip.fadeOut}
                onChange={(value) => updateAudioClip(selectedClip.id, { fadeOut: value })}
                formatValue={(value) => `${value.toFixed(1)} s`}
              />
              <ToggleRow
                label="Loop to fill clip"
                description="Repeat the source while this clip plays"
                checked={selectedClip.loop}
                onCheckedChange={(checked) => updateAudioClip(selectedClip.id, { loop: checked })}
              />
              <div className="text-sm text-muted">
                Starts at {formatTime(selectedClip.startTime)} · duration {formatTime(selectedClip.duration)}
              </div>
              <Button variant="danger" className="w-full" onClick={() => deleteAudioClip(selectedClip.id)}>
                <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                Delete music clip
              </Button>
            </div>
          </Section>
        )}

        <Section label="Mouse click sounds">
          <div className="space-y-3.5">
            <ToggleRow
              label="Enable click sounds"
              description="Disabling removes the track from export"
              checked={mouseClickSoundsEnabled}
              onCheckedChange={setMouseClickSoundsEnabled}
            />
            <div className="space-y-2">
              <SectionLabel>Sound source</SectionLabel>
              <SegmentedControl
                aria-label="Click sound source"
                options={[
                  { value: 'builtin', label: 'Built-in soft click' },
                  { value: 'custom', label: 'Use custom click sound' },
                ]}
                value={mouseClickSoundPath ? 'custom' : 'builtin'}
                onChange={(value) => {
                  if (value === 'custom') void importClickSound()
                  else setMouseClickSound(null, null)
                }}
              />
              <HelperText className="mt-2">
                {mouseClickSoundPath
                  ? `Custom: ${mouseClickSoundName || 'click sound'}`
                  : 'Built-in soft click is used for every mouse click.'}
              </HelperText>
            </div>
            <Slider
              label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={mouseClickSoundVolume}
              onChange={setMouseClickSoundVolume}
              formatValue={(value) => `${value.toFixed(2)}\u00d7`}
            />
          </div>
        </Section>

        <Section label="Original audio" labelRight={<ResetButton onClick={handleResetVolume} label="original audio" />}>
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ui text-fg">Recording audio</span>
              <span className="rounded-ctl border border-line px-2 py-0.5 text-label uppercase tracking-[0.06em] text-muted">
                {hasAudioTrack ? 'Detected' : 'Not detected'}
              </span>
            </div>
            <ToggleRow
              label="Mute"
              description="Silences the recording's own audio"
              checked={isMuted}
              onCheckedChange={setIsMuted}
            />
            <Slider
              label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={setVolume}
              formatValue={(value) => `${value.toFixed(2)}\u00d7`}
            />
          </div>
        </Section>

        <Section label="Review pauses">
          <HelperText className="mt-0">
            Finds silences of 0.45 s or longer at −35 dB. Suggestions are never applied automatically.
          </HelperText>
          <Button
            variant="secondary"
            className="mt-3 w-full"
            onClick={analyzeSilence}
            disabled={!videoPath || isAnalyzingSilence}
          >
            {isAnalyzingSilence ? (
              <>
                <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2 animate-spin" />
                Analyzing audio…
              </>
            ) : (
              <>
                <Scissors size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                Find pauses to review
              </>
            )}
          </Button>
          {!videoPath && <HelperText>Load a recording to scan its audio for pauses.</HelperText>}

          {visibleSilences.length > 0 && (
            <div className="mt-3 divide-y divide-line border-t border-line">
              {visibleSilences.map((item) => (
                <div key={`${item.start}-${item.end}`} className="space-y-2 py-3">
                  <div className="text-ui text-fg">Pause · {formatTime(item.duration)}</div>
                  <div className="font-mono text-sm tabular-nums text-muted">
                    {formatTime(item.start)} – {formatTime(item.end)}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        addCutRegion({ startTime: item.start, duration: Math.min(item.duration, Math.max(0.1, duration - item.start)) })
                        setDismissedSilences((old) => [...old, item.start])
                      }}
                    >
                      Add cut
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setDismissedSilences((old) => [...old, item.start])}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {silenceSuggestions.length > 0 && visibleSilences.length === 0 && (
            <HelperText>All detected pauses have been handled.</HelperText>
          )}
          {musicClips.length === 0 && (
            <HelperText>No music clips imported yet — import an audio file to mix it over the recording.</HelperText>
          )}
          {mouseClickSoundsEnabled && clickClips.length > 0 && (
            <HelperText>
              {clickClips.length} independent click clips. Select any click on the timeline to adjust or remove it.
            </HelperText>
          )}
        </Section>
      </div>
    </div>
  )
}
