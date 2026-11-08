import assert from 'node:assert/strict';
import test from 'node:test';

import {createPinZoomController, pinImageLayout} from '../src/pin-zoom.ts';
const scope={createPinZoomController,pinImageLayout};
const createController=createPinZoomController;

class Clock {
  now = 0;
  next = 1;
  tasks = new Map();

  setTimeout = (fn, delay) => {
    const id = this.next++;
    this.tasks.set(id, { at: this.now + delay, fn });
    return id;
  };
  cancelFrame = id => this.tasks.delete(id);
  requestFrame = fn => {
    const interval = 1000 / 60;
    const at = (Math.floor((this.now + 1e-6) / interval) + 1) * interval;
    return this.setTimeout(() => fn(this.now), at - this.now);
  };

  async advance(to) {
    for (;;) {
      await Promise.resolve();
      await Promise.resolve();
      let next;
      for (const [id, task] of this.tasks) {
        if (task.at <= to && (!next || task.at < next.task.at)) next = { id, task };
      }
      if (!next) break;
      this.tasks.delete(next.id);
      this.now = next.task.at;
      next.task.fn();
    }
    this.now = to;
    await Promise.resolve();
    await Promise.resolve();
  }
}

function rig({ latency = 8, rejectFirst = false, throwFirst = false } = {}) {
  const clock = new Clock();
  const calls = [];
  const errors = [];
  let active = 0;
  let maxActive = 0;
  const zoom = createController({
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    setTimer: clock.setTimeout,
    clearTimer: clock.cancelFrame,
    lineHeight: 16,
    pageHeight: () => 600,
    onError: error => errors.push(error.message),
    resize(factor) {
      calls.push({ at: clock.now, factor });
      if (throwFirst && calls.length === 1) throw new Error('sync failure');
      active++;
      maxActive = Math.max(active, maxActive);
      const shouldReject = rejectFirst && calls.length === 1;
      return new Promise((resolve, reject) => clock.setTimeout(() => {
        active--;
        if (shouldReject) reject(new Error('native failure'));
        else resolve();
      }, latency));
    },
  });
  const wheel = (deltaY, deltaMode = 0) => zoom.wheel({ deltaY, deltaMode, preventDefault() {} });
  return { clock, zoom, wheel, calls, errors, maxActive: () => maxActive };
}

async function gesture(r, hz, delta = 1) {
  for (let i = 0; i < hz; i++) {
    await r.clock.advance(i * 1000 / hz);
    r.wheel(delta);
  }
  await r.clock.advance(1000);
}

const cumulativeScale = calls => calls.reduce((scale, call) => scale * call.factor, 1);

test('continuous 120 Hz scrolling updates before it stops, then completely drains', async () => {
  const r = rig();
  await gesture(r, 120);
  assert.ok(r.calls.length >= 55, `only ${r.calls.length} updates during continuous scrolling`);
  assert.ok(r.calls[0].at <= 1000 / 60 + 1e-6, `first response at ${r.calls[0].at} ms`);
  await r.clock.advance(2000);
  assert.equal(r.calls.length, 60);
  assert.equal(r.maxActive(), 1);
  assert.equal(r.clock.tasks.size, 0);
  const finished = r.calls.length;
  await r.clock.advance(3000);
  assert.equal(r.calls.length, finished);
});

test('slow native bridge is single flight and coalesces newer input without a call backlog', async () => {
  const r = rig({ latency: 120 });
  await gesture(r, 120);
  assert.ok(r.calls.length >= 7 && r.calls.length <= 9);
  await r.clock.advance(2000);
  assert.equal(r.maxActive(), 1);
  assert.equal(r.clock.tasks.size, 0);
  assert.ok(Math.abs(cumulativeScale(r.calls) - Math.exp(-120 * 0.0015)) < 1e-12);
});

test('equal wheel distance gives equal zoom at different event frequencies', async () => {
  const scales = [];
  for (const hz of [20, 60, 120]) {
    const r = rig();
    await gesture(r, hz, 120 / hz);
    await r.clock.advance(1200);
    scales.push(cumulativeScale(r.calls));
  }
  for (const scale of scales) assert.ok(Math.abs(scale - Math.exp(-0.18)) < 1e-12);
});

test('wheel direction and distance determine the scale rather than just its sign', async () => {
  const factors = [];
  for (const delta of [1, 4, -4]) {
    const r = rig();
    r.wheel(delta);
    await r.clock.advance(100);
    factors.push(r.calls[0].factor);
  }
  assert.ok(factors[0] < 1 && factors[1] < factors[0] && factors[2] > 1);
  assert.ok(Math.abs(Math.log(factors[1]) - 4 * Math.log(factors[0])) < 1e-12);
  assert.ok(Math.abs(factors[1] * factors[2] - 1) < 1e-12);
});

test('pixel, line and page delta modes are normalized', async () => {
  for (const [delta, mode, equivalentPixels] of [[2, 1, 32], [0.1, 2, 60]]) {
    const a = rig();
    const b = rig();
    a.wheel(delta, mode);
    b.wheel(equivalentPixels);
    await a.clock.advance(100);
    await b.clock.advance(100);
    assert.equal(a.calls[0].factor, b.calls[0].factor);
  }
});

test('15 percent buttons use the same queue and retain their exact step', async () => {
  const r = rig({ latency: 80 });
  r.zoom.step(1.15);
  await r.clock.advance(20);
  r.zoom.step(1 / 1.15);
  r.wheel(16);
  await r.clock.advance(300);
  assert.equal(r.calls.length, 2);
  assert.equal(r.maxActive(), 1);
  assert.ok(Math.abs(r.calls[0].factor - 1.15) < 1e-12);
  assert.ok(Math.abs(cumulativeScale(r.calls) - Math.exp(-16 * 0.0015)) < 1e-12);
});

test('extreme input is bounded by the native factor contract and reverses without queued overshoot', async () => {
  const r = rig();
  for (let i = 0; i < 10000; i++) r.wheel(10000);
  await r.clock.advance(100);
  assert.deepEqual(r.calls.map(call => call.factor), [0.5]);
  r.wheel(-1);
  await r.clock.advance(200);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].factor > 1);
  assert.equal(r.clock.tasks.size, 0);
});

test('native rejection reports the error and continues with newer queued input', async () => {
  const r = rig({ rejectFirst: true, latency: 40 });
  r.wheel(5);
  await r.clock.advance(20);
  r.wheel(-7);
  await r.clock.advance(200);
  assert.deepEqual(r.errors, ['native failure']);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[1].factor > 1);
  assert.equal(r.maxActive(), 1);
  assert.equal(r.clock.tasks.size, 0);
});

test('synchronous bridge failure also releases the controller', async () => {
  const r = rig({ throwFirst: true });
  r.wheel(5);
  await r.clock.advance(20);
  r.zoom.step(1.15);
  await r.clock.advance(100);
  assert.deepEqual(r.errors, ['sync failure']);
  assert.equal(r.calls.length, 2);
  assert.equal(r.clock.tasks.size, 0);
});

test('destroy cancels a scheduled frame and ignores subsequent input', async () => {
  const r = rig();
  r.wheel(5);
  r.zoom.destroy();
  r.wheel(5);
  r.zoom.step(1.15);
  await r.clock.advance(100);
  assert.equal(r.calls.length, 0);
  assert.equal(r.clock.tasks.size, 0);
});

test('destroy during a native call drops pending input and suppresses late errors', async () => {
  const r = rig({ latency: 100, rejectFirst: true });
  r.wheel(5);
  await r.clock.advance(20);
  r.wheel(100);
  r.zoom.destroy();
  await r.clock.advance(200);
  assert.equal(r.calls.length, 1);
  assert.equal(r.errors.length, 0);
  assert.equal(r.clock.tasks.size, 0);
});

test('invalid or zero input does not allocate a frame or call the bridge', async () => {
  const r = rig();
  for (const delta of [NaN, Infinity, -Infinity, 0]) r.wheel(delta);
  for (const factor of [NaN, Infinity, -1, 0, 1]) r.zoom.step(factor);
  await r.clock.advance(100);
  assert.equal(r.calls.length, 0);
  assert.equal(r.clock.tasks.size, 0);
});


test('pin scale label starts at the real image ratio, including Retina half-size windows', () => {
  const layout = scope.pinImageLayout(365, 260, 730, 520);
  assert.equal(layout.scale, 0.5);
  assert.equal(layout.percentage, '50%');
  assert.equal(layout.left, 0);
  assert.equal(layout.top, 0);
});

test('manual edge resize fits the complete image and reports the contained scale', () => {
  const wide = scope.pinImageLayout(600, 260, 730, 520);
  assert.equal(wide.percentage, '50%');
  assert.equal(wide.width, 365);
  assert.equal(wide.height, 260);
  assert.equal(wide.left, 117.5);
  const tall = scope.pinImageLayout(365, 500, 730, 520);
  assert.equal(tall.percentage, '50%');
  assert.equal(tall.top, 120);
  assert.equal(tall.width / tall.height, 730 / 520);
});

test('updating to a cropped image recomputes scale and precision rather than retaining the previous label', () => {
  assert.equal(scope.pinImageLayout(400, 300, 800, 600).percentage, '50%');
  assert.equal(scope.pinImageLayout(400, 300, 400, 300).percentage, '100%');
  assert.equal(scope.pinImageLayout(120, 90, 4000, 3000).percentage, '3.0%');
  for (const dimensions of [[0, 100, 800, 600], [100, 100, 0, 0], [100, Infinity, 800, 600]]) {
    assert.equal(scope.pinImageLayout(...dimensions), null);
  }
});
