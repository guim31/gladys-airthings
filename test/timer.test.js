// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device created
// without should_poll (GladysAssistant/Gladys#3198, still on 5.2.1): the
// cloud must be read by the hub's own timer, with no onPoll at all, at the
// interval of the configuration, and slower when the API asks for it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  FakeAirthings,
  SALON,
  createAll,
  createWorld,
  featureId,
} from './helpers/world.js';

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function timedWorld(t, config = CONFIG) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 12, 10, 0, 0) });
  const clock = { now: () => Date.now() };
  const cloud = new FakeAirthings({ now: clock.now });
  const w = await createWorld({ clock, cloud, config, timers: true });
  t.after(() => w.app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { ...w, tick };
}

test('the internal timer reads the cloud without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w, [SALON]);
  const co2 = featureId(w.gladys, SALON, 'co2');
  const before = w.cloud.count('/sensors');

  for (const value of [700, 750, 800]) {
    w.cloud.setValue(SALON, 'co2', value);
    w.cloud.setRecorded(SALON, Date.now());
    await w.tick(5 * 60_000);
    assert.equal(w.fake.lastState(co2), value);
  }
  assert.equal(w.cloud.count('/sensors') - before, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('the interval of the configuration is applied', async (t) => {
  const w = await timedWorld(t, { ...CONFIG, refresh_minutes: '15' });
  const before = w.cloud.count('/sensors');
  await w.tick(14 * 60_000);
  assert.equal(w.cloud.count('/sensors'), before);
  await w.tick(60_000);
  assert.equal(w.cloud.count('/sensors'), before + 1);
});

test('a reading done by onPoll or the test button pushes the timer reading back', async (t) => {
  const w = await timedWorld(t);
  await createAll(w, [SALON]);
  await w.tick(4 * 60_000);
  await w.fake.action('test_connection', {});
  const before = w.cloud.count('/sensors');
  await w.tick(60_000); // the timer fires one minute after the test: skipped
  assert.equal(w.cloud.count('/sensors'), before);
  await w.tick(5 * 60_000);
  assert.equal(w.cloud.count('/sensors'), before + 1);
});

test('a 429 delays the next reading until the API allows it', async (t) => {
  const w = await timedWorld(t);
  w.cloud.rateLimitedUntil = Date.now() + 40 * 60_000;
  await w.tick(5 * 60_000); // refused: 429
  const after429 = w.cloud.requests.length;
  await w.tick(30 * 60_000);
  assert.equal(w.cloud.requests.length, after429, 'nothing sent before the end of the pause');
  await w.tick(10 * 60_000);
  assert.ok(w.cloud.requests.length > after429);
  assert.equal(w.fake.connectionStatus.message, undefined, 'back to normal');
});

test('refused credentials are tried again every 30 minutes, not every interval', async (t) => {
  const w = await timedWorld(t, { ...CONFIG, client_secret: 'wrong' });
  const before = w.cloud.count('/v1/token');
  await w.tick(29 * 60_000);
  assert.equal(w.cloud.count('/v1/token'), before);
  await w.tick(60_000);
  assert.equal(w.cloud.count('/v1/token'), before + 1);
});

test('the timer stops with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const before = w.cloud.requests.length;
  await w.tick(60 * 60_000);
  assert.equal(w.cloud.requests.length, before);
});
