// Firefox finishes WebGPU readbacks (mapAsync) on a 100 ms timer in its GPU process, so every frame that
// reads the model's output back would wait for that tick. Any queue submit makes it check right away, so
// while a frame is in flight we submit nothing (an empty command list) every few milliseconds. Chrome and
// Safari finish readbacks without this. The same trick as tract's pixel-lab demo (site/firefox-poll.mjs).

export interface SubmitQueue {
  queue: { submit(commandBuffers: Iterable<unknown>): void }
}

export function isFirefox(userAgent: string): boolean {
  return /Firefox\/\d/.test(userAgent)
}

/** First kick after half a millisecond, then the gap doubles up to 8 ms. */
export function nextPollDelay(previous: number): number {
  return previous > 0 ? Math.min(previous * 2, 8) : 0.5
}

export interface PollOptions {
  schedule?: (fn: () => void, ms: number) => unknown
  clear?: (id: unknown) => void
}

/** Resolves like `work`; meanwhile kicks `device` with empty submits so its readbacks finish promptly. */
export function withCompletionPoll<T>(work: Promise<T>, device: SubmitQueue, opts: PollOptions = {}): Promise<T> {
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clear = opts.clear ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>))
  let done = false
  let timer: unknown = null
  let delay = 0
  const kick = () => {
    timer = null
    if (done) return
    try { device.queue.submit([]) } catch { return }
    arm()
  }
  const arm = () => {
    delay = nextPollDelay(delay)
    timer = schedule(kick, delay)
  }
  arm()
  const stop = () => {
    done = true
    if (timer !== null) clear(timer)
  }
  return work.then(v => { stop(); return v }, e => { stop(); throw e })
}
