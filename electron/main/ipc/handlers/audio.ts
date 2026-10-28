// IPC for the preview's audio tracks.
//
// The renderer needs each track of the recording as a file it can play, because an
// `<audio>` element plays one thing and the preview mixes two. The extraction
// itself lives in the main process — it runs FFmpeg — and this is the thin surface
// over it.

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main'
import { extractAudioTracks } from '../../features/audio-track-extract'
import type { AudioTrack } from '../../../../shared/audio-tracks'
import { mediaUrl } from '../../../../shared/media-url'

export interface ExtractTracksRequest {
  /** The recording to take the tracks out of. */
  filePath: string
  /** The tracks to extract, as the editor holds them. */
  tracks: AudioTrack[]
}

export interface ExtractedTrackView {
  id: string
  index: number
  /** A `media://` URL, which is how the renderer reaches a local file. */
  url: string
}

export interface ExtractTracksResult {
  tracks: ExtractedTrackView[]
}

/**
 * Extract the requested tracks and hand back URLs for them.
 *
 * A track that could not be extracted is simply absent from the result: the caller
 * gets a lane it cannot play rather than a URL that fails when played.
 */
export async function handleExtractAudioTracks(
  _event: IpcMainInvokeEvent,
  request: ExtractTracksRequest,
): Promise<ExtractTracksResult> {
  try {
    const extracted = await extractAudioTracks(request.filePath, request.tracks)
    return {
      tracks: extracted.map((track) => ({
        id: track.id,
        index: track.index,
        // Encoded the way the renderer builds its own `media://` URLs — a path with
        // a space or a `#` in it would otherwise not resolve.
        url: mediaUrl(track.filePath),
      })),
    }
  } catch (error) {
    // The renderer falls back to playing the video's own audio track, so a failure
    // here is a degraded preview and not a broken editor.
    log.warn('[AudioTracks] Extraction failed:', error)
    return { tracks: [] }
  }
}

export function registerAudioHandlers(): void {
  ipcMain.handle('audio:extractTracks', handleExtractAudioTracks)
}
