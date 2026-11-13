// node tests/firefoxPoll.test.ts — the empty-submit kicker that makes Firefox finish readbacks promptly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFirefox, nextPollDelay, withCompletionPoll } from '../src/pose/firefoxPoll.ts'

test('isFirefox matches Firefox and not Chrome or Safari', () => {
  assert.equal(isFirefox('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:160.0) Gecko/20100101 Firefox/160.0'), true)
  assert.equal(isFirefox('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'), false)
})

test('the poll gap starts at half a millisecond and doubles up to 8 ms', () => {
  const gaps = [0]
  for (let i = 0; i < 6; i++) gaps.push(nextPollDelay(gaps[gaps.length - 1]))
  assert.deepEqual(gaps.slice(1), [0.5, 1, 2, 4, 8, 8])
})

test('submits empty command lists while the work is pending, and stops when it settles', async () => {
  const pending: Array<() => void> = []
  let submits = 0
  const device = { queue: { submit: (c: Iterable<unknown>) => { assert.deepEqual([...c], []); submits++ } } }
  let finish!: (v: number) => void
  const work = new Promise<number>(r => { finish = r })
  const result = withCompletionPoll(work, device, { schedule: fn => pending.push(fn), clear: () => {} })
  for (let i = 0; i < 3; i++) pending.shift()!()
  assert.equal(submits, 3)
  finish(42)
  assert.equal(await result, 42)
  // A tick that was already scheduled does nothing once the work is done.
  while (pending.length) pending.shift()!()
  assert.equal(submits, 3)
})

test('passes a rejection through and stops polling', async () => {
  let cleared = 0
  const failing = withCompletionPoll(Promise.reject(new Error('lost')), { queue: { submit() {} } }, { schedule: () => 1, clear: () => { cleared++ } })
  await assert.rejects(failing, /lost/)
  assert.equal(cleared, 1)
})
