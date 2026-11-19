// Streams renderer-recorded screen video chunks (WebM/VP9+Opus) to disk.
// Mirrors SystemAudioWriter; serializes appends so concurrent IPC chunks
// never interleave inside the WebM container.
//
// We keep this as a separate class rather than reusing SystemAudioWriter so a
// single recording session can hold both writers concurrently without sharing
// state.

import log from 'electron-log/main'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { finished } from 'node:stream/promises'

const logger = typeof log.scope === 'function' ? log.scope('screen-video-writer') : log

export class ScreenVideoWriter {
  private stream: WriteStream | null = null
  private queue: Promise<void> = Promise.resolve()
  private bytes = 0
  private chunkCount = 0
  private filePath: string | null = null
  private ended = false
  private failure: Error | null = null
  private detachStreamErrorListener: (() => void) | null = null

  start(filePath: string): void {
    if (this.stream) {
      logger.warn(`[ScreenVideoWriter] start() called while a previous session is still active (${this.filePath})`)
      throw new Error('ScreenVideoWriter.start() called while a previous session is still active')
    }

    this.filePath = filePath
    this.chunkCount = 0
    this.bytes = 0
    this.ended = false
    this.failure = null

    logger.info(`[ScreenVideoWriter] Video writer spawned, target: ${filePath}`)
    mkdirSync(path.dirname(filePath), { recursive: true })

    const stream = createWriteStream(filePath, { flags: 'w' })
    const onError = (err: Error) => {
      if (!this.failure) {
        this.failure = err
        logger.error(`[ScreenVideoWriter] Stream error on ${filePath}:`, err)
      }
    }
    stream.on('error', onError)

    this.stream = stream
    this.detachStreamErrorListener = () => {
      stream.off('error', onError)
    }
    this.queue = Promise.resolve()
  }

  async write(chunk: Buffer): Promise<number> {
    if (this.failure) {
      logger.error(`[ScreenVideoWriter] Write attempted after failure on ${this.filePath}:`, this.failure)
      throw this.failure
    }

    const stream = this.stream
    if (!stream || this.ended || stream.writableEnded || stream.destroyed) {
      return this.bytes
    }

    const writeTask = this.queue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (this.failure) {
            reject(this.failure)
            return
          }

          if (!this.stream || this.stream !== stream || this.stream.writableEnded || this.stream.destroyed) {
            resolve()
            return
          }

          this.stream.write(chunk, (err) => {
            if (err) {
              const writeError = err instanceof Error ? err : new Error(String(err))
              if (!this.failure) {
                this.failure = writeError
                logger.error(`[ScreenVideoWriter] Write error on ${this.filePath}:`, writeError)
              }
              reject(writeError)
              return
            }

            this.chunkCount++
            this.bytes += chunk.length
            if (this.chunkCount % 50 === 0 || (this.bytes >= 5 * 1024 * 1024 && this.chunkCount % 20 === 0)) {
              logger.info(
                `[ScreenVideoWriter] Progress: chunk #${this.chunkCount}, ${this.bytes} bytes written to ${this.filePath}`,
              )
            } else {
              logger.debug(
                `[ScreenVideoWriter] Chunk #${this.chunkCount} (${chunk.length} bytes, total: ${this.bytes} bytes)`,
              )
            }
            resolve()
          })
        }),
    )

    this.queue = writeTask
    await writeTask
    return this.bytes
  }

  async finalize(): Promise<void> {
    const stream = this.stream
    if (!stream) return

    this.ended = true
    logger.info(
      `[ScreenVideoWriter] Finalizing writer for ${this.filePath} (${this.chunkCount} chunks, ${this.bytes} bytes written)...`,
    )
    try {
      await this.queue
      if (this.failure) {
        throw this.failure
      }

      if (!stream.writableEnded && !stream.destroyed) {
        stream.end()
        await finished(stream)
      }
      logger.info(
        `[ScreenVideoWriter] Writer finalized successfully: ${this.filePath} (${this.chunkCount} chunks, ${this.bytes} bytes total)`,
      )
    } catch (error) {
      logger.error(`[ScreenVideoWriter] Finalize error on ${this.filePath}:`, error)
      if (!stream.destroyed) {
        stream.destroy()
        await finished(stream).catch(() => {})
      }
      throw error
    } finally {
      this.reset()
    }
  }

  async abort(): Promise<void> {
    const stream = this.stream
    if (!stream) return

    this.ended = true
    logger.warn(
      `[ScreenVideoWriter] Aborting writer for ${this.filePath} (${this.chunkCount} chunks, ${this.bytes} bytes written)`,
    )
    try {
      stream.destroy()
      await this.queue.catch(() => {})
      // Wait until the stream has actually closed before dropping our error
      // handler: a destroyed stream can still emit 'error' asynchronously.
      if (!stream.closed) await finished(stream).catch(() => {})
      logger.info(`[ScreenVideoWriter] Writer aborted and stream closed for ${this.filePath}`)
    } finally {
      this.reset()
    }
  }

  private reset(): void {
    // Keep the handler attached while the stream is still closing. Detaching it
    // early leaves a late async 'error' with no listener, which Node raises as an
    // unhandled 'error' event and takes the process down.
    if (this.stream && !this.stream.closed) {
      this.stream = null
      return
    }

    this.detachStreamErrorListener?.()
    this.detachStreamErrorListener = null
    this.stream = null
  }
}
