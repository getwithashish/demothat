import { useMemo, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { useShallow } from 'zustand/react/shallow'
import { Volume, Volume2, Volume3, Music, Trash, Upload, Mouse, PlayerPlay, Scissors, Loader2 } from 'tabler-icons-react'
import { Collapse } from '../../ui/collapse'
import { Button } from '../../ui/button'
import { cn, formatTime } from '../../../lib/utils'
import { DEFAULTS } from '../../../lib/constants'

const RangeControl = ({ label, value, min, max, step = 0.01, suffix = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void
}) => (
  <label className="block space-y-2">
    <span className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span><span className="font-mono text-sidebar-foreground">{value.toFixed(step < 1 ? 2 : 0)}{suffix}</span></span>
    <input className="w-full accent-primary" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
)

export function AudioSettings() {
  const [isImporting, setIsImporting] = useState(false)
  const [isAnalyzingSilence, setIsAnalyzingSilence] = useState(false)
  const [silenceSuggestions, setSilenceSuggestions] = useState<{ start: number; end: number; duration: number }[]>([])
  const [dismissedSilences, setDismissedSilences] = useState<number[]>([])
  const {
    volume, isMuted, setVolume, toggleMute, setIsMuted, hasAudioTrack, duration, currentTime, videoPath,
    audioClips, selectedRegionId, addAudioClip, updateAudioClip, deleteAudioClip, addCutRegion,
    mouseClickSoundsEnabled, setMouseClickSoundsEnabled, mouseClickSoundPath, mouseClickSoundName,
    setMouseClickSound, mouseClickSoundVolume, setMouseClickSoundVolume,
  } = useEditorStore(useShallow((state) => ({
    volume: state.volume, isMuted: state.isMuted, setVolume: state.setVolume, toggleMute: state.toggleMute, setIsMuted: state.setIsMuted,
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

  return (
    <div className="h-full flex flex-col bg-sidebar text-sidebar-foreground">
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Music className="w-5 h-5 text-primary" /></div>
          <div><h2 className="text-lg font-semibold text-sidebar-foreground">Audio & Music</h2><p className="text-sm text-muted-foreground">Import, trim, loop and mix timeline audio</p></div>
        </div>
        <Button className="mt-4 w-full" onClick={importAudio} disabled={isImporting}><Upload className="mr-2 h-4 w-4" />{isImporting ? 'Importing…' : 'Import audio file'}</Button>
      </div>
      <div className="flex-1 overflow-y-auto stable-scrollbar p-6 space-y-5">
        {selectedClickClip && (
          <Collapse title="Selected click sound" description={formatTime(selectedClickClip.startTime)} icon={<Mouse className="w-4 h-4 text-primary" />} defaultOpen>
            <div className="space-y-4 pt-2">
              <p className="text-xs leading-relaxed text-muted-foreground">This click is an independent timeline clip. Move it in the timeline or delete it without affecting other clicks.</p>
              <RangeControl label="Click clip volume" value={selectedClickClip.volume} min={0} max={1} step={0.05} suffix="×" onChange={(value) => updateAudioClip(selectedClickClip.id, { volume: value })} />
              <div className="text-xs text-muted-foreground">Position {formatTime(selectedClickClip.startTime)}</div>
              <Button variant="destructive" className="w-full" onClick={() => deleteAudioClip(selectedClickClip.id)}><Trash className="mr-2 h-4 w-4" />Delete this click</Button>
            </div>
          </Collapse>
        )}

        {selectedClip ? (
          <Collapse title="Selected music clip" description={selectedClip.name} icon={<Music className="w-4 h-4 text-primary" />} defaultOpen onReset={() => updateAudioClip(selectedClip.id, { volume: 1, fadeIn: 0, fadeOut: 0, loop: false })}>
            <div className="space-y-4 pt-2">
              <p className="text-xs text-muted-foreground">Move or trim the clip directly in the timeline. These controls adjust its mix and playback.</p>
              <RangeControl label="Clip volume" value={selectedClip.volume} min={0} max={1} step={0.05} suffix="×" onChange={(value) => updateAudioClip(selectedClip.id, { volume: value })} />
              <RangeControl label="Playback speed" value={selectedClip.speed ?? 1} min={0.5} max={2} step={0.05} suffix="×" onChange={(value) => updateAudioClip(selectedClip.id, { speed: value, duration: Math.max(0.1, Math.min(duration - selectedClip.startTime, selectedClip.duration * (selectedClip.speed ?? 1) / value)) })} />
              <RangeControl label="Clip duration" value={selectedClip.duration} min={0.1} max={Math.max(0.1, duration - selectedClip.startTime)} step={0.1} suffix="s" onChange={(value) => updateAudioClip(selectedClip.id, { duration: value })} />
              <RangeControl label="Fade in" value={selectedClip.fadeIn} min={0} max={Math.min(10, selectedClip.duration)} step={0.1} suffix="s" onChange={(value) => updateAudioClip(selectedClip.id, { fadeIn: value })} />
              <RangeControl label="Fade out" value={selectedClip.fadeOut} min={0} max={Math.min(10, selectedClip.duration)} step={0.1} suffix="s" onChange={(value) => updateAudioClip(selectedClip.id, { fadeOut: value })} />
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"><span><span className="block font-medium">Loop to fill clip</span><span className="text-xs text-muted-foreground">Repeat the source while this clip plays</span></span><input type="checkbox" checked={selectedClip.loop} onChange={(event) => updateAudioClip(selectedClip.id, { loop: event.target.checked })} /></label>
              <div className="text-xs text-muted-foreground">Starts at {formatTime(selectedClip.startTime)} · duration {formatTime(selectedClip.duration)}</div>
              <Button variant="destructive" className="w-full" onClick={() => deleteAudioClip(selectedClip.id)}><Trash className="mr-2 h-4 w-4" />Delete music clip</Button>
            </div>
          </Collapse>
        ) : !selectedClickClip ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm leading-relaxed text-muted-foreground">Select a music clip in the timeline to edit its volume, trim, speed, loop and fades.</div>
        ) : null}

        <Collapse title="Mouse click sounds" description="A dedicated timeline track, included in export" icon={<Mouse className="w-4 h-4 text-primary" />} defaultOpen>
          <div className="space-y-4 pt-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"><span><span className="block font-medium">Enable click sounds</span><span className="text-xs text-muted-foreground">Disabling removes the track and excludes it from export</span></span><input type="checkbox" checked={mouseClickSoundsEnabled} onChange={(event) => setMouseClickSoundsEnabled(event.target.checked)} /></label>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-sidebar-foreground"><div className="font-medium">Sound source</div><div className="mt-1 truncate text-xs text-muted-foreground">{mouseClickSoundName || 'Built-in soft click'}</div></div>
            <Button variant="outline" className="w-full" onClick={importClickSound}><Upload className="mr-2 h-4 w-4" />Use custom click sound</Button>
            {mouseClickSoundPath && <Button variant="ghost" className="w-full" onClick={() => setMouseClickSound(null, null)}>Restore built-in click</Button>}
            <RangeControl label="Click sound volume" value={mouseClickSoundVolume} min={0} max={1} step={0.05} suffix="×" onChange={setMouseClickSoundVolume} />
          </div>
        </Collapse>

        <Collapse title="Original video audio" description="Volume of the recording's own audio" icon={<Volume className="w-4 h-4 text-primary" />} defaultOpen={false} onReset={handleResetVolume}>
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-3 text-sm"><span>{hasAudioTrack ? 'Original audio detected' : 'No original audio detected'}</span><button className={cn('rounded-md border px-3 py-1.5 text-xs', isMuted && 'bg-muted')} onClick={toggleMute}>{isMuted ? <Volume3 className="inline mr-1 h-3 w-3" /> : <Volume2 className="inline mr-1 h-3 w-3" />}{isMuted ? 'Muted' : 'Unmuted'}</button></div>
            <RangeControl label="Original audio volume" value={isMuted ? 0 : volume} min={0} max={1} step={0.05} suffix="×" onChange={setVolume} />
          </div>
        </Collapse>

        <Collapse title="Review pauses" description="Find silences in the recording audio and turn them into cuts" icon={<Scissors className="w-4 h-4 text-primary" />} defaultOpen={false}>
          <div className="space-y-3 pt-2">
            <p className="text-xs leading-relaxed text-muted-foreground">Detects pauses at −35 dB or quieter lasting at least 0.45 s. Suggestions are shown below and are never applied automatically.</p>
            <Button variant="outline" className="w-full" onClick={analyzeSilence} disabled={!videoPath || isAnalyzingSilence}>
              {isAnalyzingSilence ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing audio…</> : <><Scissors className="mr-2 h-4 w-4" />Find pauses to review</>}
            </Button>
            {!videoPath && <p className="text-xs text-muted-foreground">Load a recording to scan its audio for pauses.</p>}
            {visibleSilences.map((item) => (
              <div key={`${item.start}-${item.end}`} className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="text-xs font-medium text-foreground">Pause · {formatTime(item.duration)}</div>
                <div className="text-[11px] text-muted-foreground">{formatTime(item.start)} – {formatTime(item.end)}</div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => { addCutRegion({ startTime: item.start, duration: Math.min(item.duration, Math.max(0.1, duration - item.start)) }); setDismissedSilences((old) => [...old, item.start]) }}>Add cut</Button>
                  <Button size="sm" variant="outline" onClick={() => setDismissedSilences((old) => [...old, item.start])}>Dismiss</Button>
                </div>
              </div>
            ))}
            {silenceSuggestions.length > 0 && visibleSilences.length === 0 && <p className="text-xs text-muted-foreground">All detected pauses have been handled.</p>}
          </div>
        </Collapse>

        {musicClips.length === 0 && <div className="text-center text-xs text-muted-foreground"><PlayerPlay className="mx-auto mb-2 h-4 w-4" />No music clips imported yet.</div>}
        {mouseClickSoundsEnabled && clickClips.length > 0 && <p className="text-xs text-muted-foreground">{clickClips.length} independent click clips. Select any click on the timeline to adjust or remove it.</p>}
      </div>
    </div>
  )
}
