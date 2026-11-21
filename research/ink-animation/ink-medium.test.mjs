import test from 'node:test';
import assert from 'node:assert/strict';
import { InkMedium2D } from './ink-medium.js';

function makeFlow(seed = 17, options = {}) {
  const m = new InkMedium2D(96, 64, seed, options);
  m.setVelocity((x, y, w, h) => ({
    x: 0.08 * Math.sin(y * 0.09 + x * 0.03),
    y: 0.85 + 0.12 * Math.sin(x * 0.11),
  }));
  m.dabWater(48, 7, 8, 0.24);
  m.dabInk(40, 8, 5, 0.12);
  m.dabInk(56, 8, 5, 0.12);
  return m;
}

test('water and pigment ledgers remain conservative', () => {
  const m = makeFlow();
  for (let i = 0; i < 240; i++) m.step(0.04);
  const s = m.stats();
  assert.ok(s.waterBalanceError < 2e-6, 'water balance ' + s.waterBalanceError);
  assert.ok(s.inkBalanceError < 2e-6, 'ink balance ' + s.inkBalanceError);
  assert.ok(s.min >= -1e-7, 'negative field value ' + s.min);
  assert.equal(s.bad, 0);
});

test('downstream flow transports the water front', () => {
  const m = makeFlow(31, { binding: 0.015, evaporation: 0.002, diffusion: 0.02 });
  const before = m.stats().waterCenterY;
  for (let i = 0; i < 100; i++) m.step(0.04);
  const after = m.stats().waterCenterY;
  assert.ok(after > before + 1.5, 'expected downstream motion, before=' + before + ', after=' + after);
});

test('same seed and operations produce identical states', () => {
  const a = makeFlow(77), b = makeFlow(77);
  for (let i = 0; i < 80; i++) { a.step(0.04); b.step(0.04); }
  assert.deepEqual(a.water, b.water);
  assert.deepEqual(a.mobile, b.mobile);
  assert.deepEqual(a.fixed, b.fixed);
});

test('invalid input is rejected instead of poisoning the state', () => {
  const m = new InkMedium2D();
  assert.throws(() => m.step(0), RangeError);
  assert.throws(() => m.dabInk(2, 2, 0, 1), RangeError);
  assert.throws(() => m.setVelocity(null), TypeError);
});

test('mobile pigment follows the downstream flow before binding', () => {
  const m = makeFlow(31, { binding: 0.015, evaporation: 0.002, diffusion: 0.02 });
  const before = m.stats().inkCenterY;
  for (let i = 0; i < 100; i++) m.step(0.04);
  const after = m.stats().inkCenterY;
  assert.ok(after > before + 0.4, 'expected pigment transport, before=' + before + ', after=' + after);
});

test('paper-fiber direction biases diffusion along the grain', () => {
  const m = new InkMedium2D(21, 21, 5, { diffusion: 0.8, evaporation: 0, binding: 0, edgeDeposition: 0 });
  m.water.fill(1);
  m.addedWater = m.n;
  m.fiberX.fill(1);
  m.fiberY.fill(0);
  const cx = 10, cy = 10, center = cy * m.w + cx;
  m.mobile[center] = 1;
  m.addedInk = 1;
  m.step(0.2);
  const horizontal = m.mobile[center - 1];
  const vertical = m.mobile[center - m.w];
  assert.ok(horizontal > vertical, 'expected along-grain diffusion, horizontal=' + horizontal + ', vertical=' + vertical);
  assert.ok(m.stats().inkBalanceError < 1e-6);
});
