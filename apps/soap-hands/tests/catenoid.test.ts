// node tests/catenoid.test.ts — the catenoid solver and its stability limit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catenoidLimit, catenoidRadius, neckRadius, solveCatenoid } from '../src/geom/catenoid.ts'

test('equal radii: the Goldschmidt limit h/R ≈ 1.3255', () => {
  for (const R of [1, 0.05, 3]) {
    const { hMax } = catenoidLimit(R, R)
    assert.ok(Math.abs(hMax / R - 1.32549) < 1e-3, `hMax/R = ${hMax / R}`)
  }
})

test('boundary radii are met, the stable branch is the wide one', () => {
  for (const [R1, R2, h] of [[1, 1, 1], [1, 1, 0.2], [1, 1.5, 0.8], [1.5, 1, 0.8], [0.04, 0.06, 0.03], [1, 2, 0.1], [2, 1, 0.1]]) {
    const c = solveCatenoid(R1, R2, h)
    assert.ok(c.exists, `${R1} ${R2} ${h}`)
    assert.ok(Math.abs(catenoidRadius(c, 0) - R1) < 1e-6 * R1, `r(0) ${catenoidRadius(c, 0)} vs ${R1}`)
    assert.ok(Math.abs(catenoidRadius(c, h) - R2) < 1e-6 * R2, `r(h) ${catenoidRadius(c, h)} vs ${R2}`)
  }
  // R = 1, h = 1: the stable neck is a ≈ 0.8483 (the unstable one ≈ 0.2350).
  assert.ok(Math.abs(solveCatenoid(1, 1, 1).a - 0.8483) < 1e-3)
  // Close unequal rings: a trumpet with its neck outside, nearly the flat annulus.
  const t = solveCatenoid(1, 2, 0.1)
  assert.ok(t.z0 < 0)
  assert.equal(neckRadius(t), 1)
})

test('past the limit there is no catenoid', () => {
  assert.equal(solveCatenoid(1, 1, 1.33).exists, false)
  assert.equal(solveCatenoid(1, 1, 1.32).exists, true)
  const { hMax } = catenoidLimit(1, 1.6)
  assert.equal(solveCatenoid(1, 1.6, hMax * 1.01).exists, false)
  assert.equal(solveCatenoid(1, 1.6, hMax * 0.99).exists, true)
  // The neck shrinks toward the limit but stays open.
  assert.ok(neckRadius(solveCatenoid(1, 1, 1.32)) > 0.4)
})
