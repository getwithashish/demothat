// The Captions panel: transcribe the recording, and turn the transcript into captions.
//
// This is the panel the transcription feature was always missing — the IPC, the worker
// call and the sidecar writer all existed, but nothing in the UI ever triggered a
// transcription, so the feature was unreachable.
//
// Two things are deliberate here:
//
// **The transcript is stored in the project and captions are derived from it.** Running a
// transcription costs credits, so it happens once and is saved with the project; the
// captions are a view of it. That is what makes the filler-word toggle instant and
// reversible — nothing is re-uploaded, and the transcript itself is never edited, so the
// user can turn the removal off and get the original words back.
//
// **Filler removal is a property of the captions, not of the video.** The recording is
// untouched; what changes is the text a viewer reads. The panel says so, and says how
// many words it took out.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../../store/editorStore'
import { Button } from '../../ui/button'
import { Section } from '../../ui/section'
import { ToggleRow } from '../../ui/toggle-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Loader2, Microphone, Trash, CircleCheck, Ban, AlertTriangle } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { cuesFromTranscript, type SubtitleFormat } from '../../../../shared/subtitles'
import { removeFillers } from '../../../../shared/fillers'
import { mapSourceTimeToExportTime } from '../../../lib/utils'

interface TranscribeStatusLike {
  configured: boolean
  transcription: { enabled?: boolean; creditsPerMinute?: number; models?: string[]; maxAudioSeconds?: number } | null
  error: string | null
}

interface TranscribeProgressLike {
  stage: string
  stagePercent: number
  reserved?: number
  audioSeconds?: number
  audioSecondsDone?: number
  charge?: number
}

export function SubtitlesSettings() {
  const {
    transcript,
    subtitleCues,
    subtitlesEnabled,
    subtitleFormat,
    videoPath,
    duration,
    cutRegions,
    speedRegions,
    setTranscript,
    setSubtitleCues,
    setSubtitlesEnabled,
    setSubtitleFormat,
    updateSubtitleCue,
    removeSubtitleCue,
  } = useEditorStore(
    useShallow((state) => ({
      transcript: state.transcript,
      subtitleCues: state.subtitleCues,
      subtitlesEnabled: state.subtitlesEnabled,
      subtitleFormat: state.subtitleFormat,
      videoPath: state.videoPath,
      duration: state.duration,
      cutRegions: state.cutRegions,
      speedRegions: state.speedRegions,
      setTranscript: state.setTranscript,
      setSubtitleCues: state.setSubtitleCues,
      setSubtitlesEnabled: state.setSubtitlesEnabled,
      setSubtitleFormat: state.setSubtitleFormat,
      updateSubtitleCue: state.updateSubtitleCue,
      removeSubtitleCue: state.removeSubtitleCue,
    })),
  )

  const [status, setStatus] = useState<TranscribeStatusLike | null>(null)
  const [isRunning, setRunning] = useState(false)
  const [progress, setProgress] = useState<TranscribeProgressLike | null>(null)
  const [error, setError] = useState<string | null>(null)
  // On by default: a hesitation sound is noise in a caption, and the transcript keeps
  // the original words so nothing is lost by having it on.
  const [stripFillers, setStripFillers] = useState(true)
  const [dropStutters, setDropStutters] = useState(false)
  const [removed, setRemoved] = useState<number | null>(null)
  const [settled, setSettled] = useState<{ charge: number; audioSeconds: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.transcribeStatus().then((next) => {
      if (!cancelled) setStatus(next as TranscribeStatusLike)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const off = window.electronAPI.onTranscribeProgress((payload) => {
      setProgress(payload as TranscribeProgressLike)
    })
    return () => {
      off()
    }
  }, [])

  /** Source time → export time, so a caption lands on the frames it describes. */
  const mapper = useCallback(
    (sourceTime: number) => mapSourceTimeToExportTime(sourceTime, duration, cutRegions, speedRegions),
    [duration, cutRegions, speedRegions],
  )

  /**
   * Turn the stored transcript into captions, applying the current filler settings.
   *
   * Never mutates the transcript: `removeFillers` returns a new document, so turning the
   * toggle back off reproduces the original captions exactly.
   */
  const deriveCues = useCallback(
    (options: { stripFillers: boolean; dropStutters: boolean }) => {
      const current = useEditorStore.getState().transcript
      if (current === null) {
        setRemoved(null)
        return
      }
      const result = options.stripFillers ? removeFillers(current, { dropStutters: options.dropStutters }) : null
      const source = result?.transcript ?? current
      setSubtitleCues(cuesFromTranscript(source, mapper))
      setRemoved(result === null ? null : result.removedCount)
    },
    [mapper, setSubtitleCues],
  )

  // Toggling a filler option re-derives from the transcript already in the project —
  // instant, free, and reversible.
  useEffect(() => {
    if (transcript === null) return
    deriveCues({ stripFillers, dropStutters })
  }, [transcript, stripFillers, dropStutters, deriveCues])

  const transcribe = useCallback(async () => {
    if (videoPath === null) return
    setRunning(true)
    setError(null)
    setSettled(null)
    setProgress({ stage: 'Extracting audio', stagePercent: 0 })
    try {
      const result = await window.electronAPI.startTranscription({ sourcePath: videoPath })
      if (result.ok) {
        setTranscript(result.transcript as never)
        // The effect above derives the captions once the transcript lands.
        setSettled({ charge: result.charge, audioSeconds: result.audioSeconds })
      } else {
        setError(result.error)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }, [videoPath, setTranscript])

  const enabled = status?.transcription?.enabled === true
  const price = status?.transcription?.creditsPerMinute

  const summary = useMemo(() => {
    if (transcript === null) return null
    return {
      segments: transcript.segments.length,
      language: transcript.language ?? 'auto',
      model: transcript.model,
      duration: transcript.durationSec,
    }
  }, [transcript])

  return (
    <div className="h-full overflow-y-auto">
      <Section label="Transcription" first>
        {status !== null && !status.configured && (
          <p className="text-sm text-muted">
            This computer is not activated, so it cannot transcribe. Enter your license key first.
          </p>
        )}

        {status !== null && status.configured && !enabled && (
          <p className="text-sm text-muted">Transcription is switched off for this deployment right now.</p>
        )}

        {videoPath === null && <p className="text-sm text-muted">Open a recording to transcribe it.</p>}

        {videoPath !== null && transcript === null && (
          <>
            <Button size="sm" onClick={() => void transcribe()} disabled={isRunning || !enabled}>
              {isRunning ? (
                <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2 animate-spin" />
              ) : (
                <Microphone size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
              )}
              {isRunning ? 'Transcribing…' : 'Transcribe this recording'}
            </Button>
            <p className="mt-2 text-sm text-muted">
              {price !== undefined
                ? `${price} credits per minute of audio. The transcript is saved with the project, so this is charged once.`
                : 'The transcript is saved with the project, so this is charged once.'}
            </p>
          </>
        )}

        {isRunning && progress !== null && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-sm text-fg">
              <span>{progress.stage}</span>
              <span className="text-muted">{Math.round(progress.stagePercent)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ctl">
              <div
                className="h-full bg-accent transition-all duration-200"
                style={{ width: `${Math.max(2, progress.stagePercent)}%` }}
              />
            </div>
            {progress.audioSeconds !== undefined && (
              <p className="text-xs text-muted">
                {Math.round(progress.audioSecondsDone ?? 0)}s of {Math.round(progress.audioSeconds)}s
              </p>
            )}
            <Button variant="ghost" size="sm" onClick={() => window.electronAPI.cancelTranscription()}>
              Cancel
            </Button>
          </div>
        )}

        {error !== null && (
          <div className="mt-3 flex items-start gap-2 text-sm text-fg">
            <Ban size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mt-0.5 text-danger" />
            <span>{error}</span>
          </div>
        )}

        {summary !== null && (
          <div className="mt-3 space-y-2">
            <div className="flex items-start gap-2 text-sm text-fg">
              <CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mt-0.5 text-accent" />
              <span>
                Transcribed: {summary.segments} segments, {summary.language}, saved with the project.
              </span>
            </div>
            {settled !== null && (
              <p className="text-xs text-muted">
                {settled.charge} credits charged for {Math.round(settled.audioSeconds)}s of audio.
              </p>
            )}
            <Button variant="secondary" size="sm" onClick={() => void transcribe()} disabled={isRunning || !enabled}>
              Transcribe again
            </Button>
          </div>
        )}
      </Section>

      {transcript !== null && (
        <>
          <Section label="Filler words">
            <ToggleRow
              id="strip-fillers"
              label="Remove filler words"
              description="um, uh, hmm and the like. The captions lose them; the recording is untouched."
              checked={stripFillers}
              onCheckedChange={setStripFillers}
            />
            <div className="mt-2">
              <ToggleRow
                id="drop-stutters"
                label="Also collapse stutters"
                description="Turns “I I think” into “I think”."
                checked={dropStutters}
                onCheckedChange={setDropStutters}
                disabled={!stripFillers}
              />
            </div>
            {removed !== null && (
              <p className="mt-2 text-xs text-muted">
                {removed === 0
                  ? 'Nothing to remove — this recording has no filler words.'
                  : `${removed} filler ${removed === 1 ? 'word' : 'words'} removed from the captions. Turn this off to get them back.`}
              </p>
            )}
            {removed === null && (
              <p className="mt-2 text-xs text-muted">The captions keep every word, exactly as transcribed.</p>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
              <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
              Word choice is deliberately narrow: “like”, “so” and “right” carry meaning in some sentences, so they are
              never removed automatically.
            </p>
          </Section>

          <Section label="Captions">
            <ToggleRow
              id="subtitles-enabled"
              label="Write captions with the export"
              description="A sidecar file beside the video, and a caption track on published videos."
              checked={subtitlesEnabled}
              onCheckedChange={setSubtitlesEnabled}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-ui text-fg">Format</span>
              <Select value={subtitleFormat} onValueChange={(value) => setSubtitleFormat(value as SubtitleFormat)}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="srt">SubRip (.srt)</SelectItem>
                  <SelectItem value="vtt">WebVTT (.vtt)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="mt-2 text-xs text-muted">
              {subtitleCues.length} {subtitleCues.length === 1 ? 'caption' : 'captions'} on the timeline. Click one
              below to reword it.
            </p>
          </Section>

          <Section label="Cues">
            {subtitleCues.length === 0 ? (
              <p className="text-sm text-muted">
                No captions yet. The transcript produced none — that can happen for a recording with no speech.
              </p>
            ) : (
              <ul className="space-y-2">
                {subtitleCues.map((cue, index) => (
                  <li key={cue.id} className="rounded-ctl border border-border/50 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-xs text-muted">
                        {formatClock(cue.start)} → {formatClock(cue.end)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Delete caption ${index + 1}`}
                        onClick={() => removeSubtitleCue(cue.id)}
                        className="rounded-ctl p-1 text-muted transition-colors hover:text-danger"
                      >
                        <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                      </button>
                    </div>
                    <textarea
                      value={cue.text}
                      onChange={(event) => updateSubtitleCue(cue.id, { text: event.target.value })}
                      rows={2}
                      className="w-full resize-none rounded-ctl border border-border/50 bg-ctl/40 p-1.5 text-xs text-fg"
                    />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

/** `00:12` — enough for a cue list, and unambiguous. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
