// Filler-word removal: a feature of transcription, not of the video.
//
// The transcript is the artifact a transcription produces, and the words a viewer
// reads are the captions. So "remove the filler words" means the captions come out
// clean — the recording itself is never touched, which is why this is a pure
// transformation of a `TranscriptDocument` and not an edit to the timeline.
//
// Three decisions worth stating, because each one is a choice a reader would
// otherwise have to guess at:
//
// **The list is deliberately short.** `like`, `so`, `right` and `actually` are all
// filler in some sentences and load-bearing in others ("I like this", "so that it
// works"). Removing them automatically would silently change what someone said. Only
// hesitation sounds — the ones that carry no meaning in any sentence — are here.
//
// **Words, not sentences.** With word timings present (which is what the app asks
// the worker for) a filler is removed by word, so the words around it keep their own
// timings and a caption never shifts off the audio it describes. Without word
// timings the fallback is a text-level pass over each segment, which can only remove
// whole tokens from a string — coarser, but never wrong about which words go.
//
// **Nothing is destroyed.** `removeFillers` returns what it removed, so the app can
// say "9 filler words removed" and the user can turn the feature off and get the
// original captions back — the transcript stored in the project is never modified.

import type { TranscriptDocument, TranscriptSegment, TranscriptWord } from './transcript'

/**
 * Hesitations, and only hesitations.
 *
 * Keys are lowercased and punctuation-stripped before lookup, so "Um," and "uhh..."
 * both match.
 */
export const FILLER_WORDS: readonly string[] = [
  'um',
  'umm',
  'ummm',
  'uh',
  'uhh',
  'uhhh',
  'er',
  'erm',
  'ah',
  'ahh',
  'hmm',
  'hmmm',
  'mm',
  'mmm',
  'mhm',
  'mmhm',
  'huh',
]

export interface RemoveFillersOptions {
  /**
   * Remove immediate word repetitions ("I I think", "the the file").
   *
   * A stutter is the same kind of event as a hesitation and reads the same way in a
   * caption; it is separable only because a repeat is also how a speaker emphasises a
   * word ("very very good"), so a user may want the hesitations gone and the repeats
   * kept.
   */
  dropStutters?: boolean
  /** Extra words to treat as fillers, for a speaker's own habits. */
  extraWords?: readonly string[]
}

export interface RemovedFiller {
  text: string
  /** Source-time start, when the transcript carried word timings. */
  start?: number
  end?: number
}

export interface RemoveFillersResult {
  transcript: TranscriptDocument
  removed: RemovedFiller[]
  /** Words dropped. What the UI reports. */
  removedCount: number
}

/** A word with its punctuation stripped, for matching only. */
function bareWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, '')
    .trim()
}

/** True when a token is a hesitation, by the list plus the caller's extras. */
export function isFiller(text: string, extraWords: readonly string[] = []): boolean {
  const bare = bareWord(text)
  if (bare.length === 0) return false
  // "ummm" with any number of trailing m's or h's is still a hesitation.
  if (/^u+m+h*$/.test(bare) || /^u+h+$/.test(bare) || /^e+r+m*$/.test(bare)) return true
  if (/^h+m+$/.test(bare) || /^m+h+m*$/.test(bare) || /^m+$/.test(bare)) return true
  if (FILLER_WORDS.includes(bare)) return true
  return extraWords.some((word) => bareWord(word) === bare)
}

/**
 * Remove the filler words from a transcript.
 *
 * Returns a new document; the input is never mutated, so a caller that keeps the
 * original (the project does) can always get back to it.
 */
export function removeFillers(transcript: TranscriptDocument, options: RemoveFillersOptions = {}): RemoveFillersResult {
  const extras = options.extraWords ?? []
  const removed: RemovedFiller[] = []
  const segments: TranscriptSegment[] = []

  for (const segment of transcript.segments) {
    // Word timings are the good case: drop whole words and rebuild the text from
    // what is left, so the surviving words keep their own timings.
    if (segment.words !== undefined && segment.words.length > 0) {
      const kept: TranscriptWord[] = []
      let previousBare: string | null = null
      for (const word of segment.words) {
        if (isFiller(word.text, extras)) {
          removed.push({ text: word.text.trim(), start: word.start, end: word.end })
          continue
        }
        const bare = bareWord(word.text)
        if (options.dropStutters === true && bare.length > 0 && previousBare !== null && bare === previousBare) {
          removed.push({ text: word.text.trim(), start: word.start, end: word.end })
          continue
        }
        previousBare = bare.length > 0 ? bare : previousBare
        kept.push(word)
      }

      // A segment whose every word was a hesitation has no caption left to show.
      if (kept.length === 0) {
        continue
      }
      segments.push({ ...segment, text: joinWords(kept.map((word) => word.text)), words: kept })
      continue
    }

    // No word timings: the best available pass is over the segment's text.
    const tokens = segment.text.split(/(\s+)/)
    const keptTokens: string[] = []
    let previousBare: string | null = null
    for (const token of tokens) {
      if (token.trim().length === 0) {
        keptTokens.push(token)
        continue
      }
      if (isFiller(token, extras)) {
        removed.push({ text: token.trim() })
        continue
      }
      const bare = bareWord(token)
      if (options.dropStutters === true && bare.length > 0 && previousBare !== null && bare === previousBare) {
        removed.push({ text: token.trim() })
        continue
      }
      previousBare = bare.length > 0 ? bare : previousBare
      keptTokens.push(token)
    }

    const text = tidy(keptTokens.join(''))
    if (text.length === 0) continue
    segments.push({ ...segment, text })
  }

  return {
    transcript: { ...transcript, segments },
    removed,
    removedCount: removed.length,
  }
}

/**
 * Put a segment's words back into a sentence.
 *
 * The worker's word texts keep their own spacing and punctuation, so the naive
 * `join('')` is right for a well-formed transcript and `join(' ')` is right for one
 * where the model emitted bare words. Deciding per boundary rather than per document
 * means both come out readable.
 */
function joinWords(words: string[]): string {
  let out = ''
  for (const word of words) {
    if (out.length === 0) {
      out = word.trimStart()
      continue
    }
    const needsSpace = !/[\s]$/.test(out) && !/^[,.!?;:…]/.test(word)
    out += needsSpace ? ` ${word.trimStart()}` : word
  }
  return tidy(out)
}

/** Collapse the whitespace a removal leaves behind, and fix a stranded comma. */
function tidy(text: string): string {
  return text
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:]+/, '')
    .trim()
}
