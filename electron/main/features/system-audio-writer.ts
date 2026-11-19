// Streams system-audio chunks (WebM/Opus) from the renderer to a file on disk.
// Append writes are serialized via a promise queue so concurrent IPC chunks
// never interleave inside the WebM container.

import log from 'electron-log/main'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { finished } from 'node:stream/promises'

const logger = typeof log.scope === 'function' ? log.scope('system-audio-writer') : log

export class SystemAudioWriter {
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
      logger.warn(`[SystemAudioWriter] start() called while a previous session is still active (${this.filePath})`)
      throw new Error('SystemAudioWriter.start() called while a previous session is still active')
    }

    this.filePath = filePath
    this.chunkCount = 0
    this.bytes = 0
    this.ended = false
    this.failure = null

    logger.info(`[SystemAudioWriter] Audio writer spawned, target: ${filePath}`)
    mkdirSync(path.dirname(filePath), { recursive: true })

    const stream = createWriteStream(filePath, { flags: 'w' })
    const onError = (err: Error) => {
      if (!this.failure) {
        this.failure = err
        logger.error(`[SystemAudioWriter] Stream error on ${filePath}:`, err)
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
      logger.error(`[SystemAudioWriter] Write attempted after failure on ${this.filePath}:`, this.failure)
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
                logger.error(`[SystemAudioWriter] Write error on ${this.filePath}:`, writeError)
              }
              reject(writeError)
              return
            }

            this.chunkCount++
            this.bytes += chunk.length
            if (this.chunkCount % 50 === 0 || (this.bytes >= 2 * 1024 * 1024 && this.chunkCount % 20 === 0)) {
              logger.info(
                `[SystemAudioWriter] Progress: chunk #${this.chunkCount}, ${this.bytes} bytes written to ${this.filePath}`,
              )
            } else {
              logger.debug(
                `[SystemAudioWriter] Chunk #${this.chunkCount} (${chunk.length} bytes, total: ${this.bytes} bytes)`,
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
      `[SystemAudioWriter] Finalizing writer for ${this.filePath} (${this.chunkCount} chunks, ${this.bytes} bytes written)...`,
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
        `[SystemAudioWriter] Writer finalized successfully: ${this.filePath} (${this.chunkCount} chunks, ${this.bytes} bytes total)`,
      )
    } catch (error) {
      logger.error(`[SystemAudioWriter] Finalize error on ${this.filePath}:`, error)
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
      `[SystemAudioWriter] Aborting writer for ${this.filePath} (${this.chunkCount} chunks, ${this.bytes} bytes written)`,
    )
    try {
      stream.destroy()
      await this.queue.catch(() => {})
      // Wait until the stream has actually closed before dropping our error
      // handler: a destroyed stream can still emit 'error' asynchronously.
      if (!stream.closed) await finished(stream).catch(() => {})
      logger.info(`[SystemAudioWriter] Writer aborted and stream closed for ${this.filePath}`)
    } finally {
      this.reset()
    }
  }

  private reset(): void {
    // Keep the handler attached while the stream is still closing. Detaching it
    // early leaves a late async 'error' (e.g. a pending open that fails after the
    // file is removed) with no listener, which Node raises as an unhandled
    // 'error' event and takes the process down.
    if (this.stream && !this.stream.closed) {
      this.stream = null
      return
    }

    this.detachStreamErrorListener?.()
    this.detachStreamErrorListener = null
    this.stream = null
  }
}
