// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading cycle writes nothing, a failure that repeats is
// logged once, and its end once. Never the client id, the secret or a token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  CONFIG,
  SALON,
  createAll,
  createWorld,
} from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to the Airthings cloud: 5 sensor(s)')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();
  for (let i = 0; i < 15; i += 1) {
    w.cloud.setValue(SALON, 'co2', 600 + i * 10);
    w.cloud.setRecorded(SALON, w.clock.now());
    w.clock.advance(5 * 60_000); // the device list is read again on the way
    await w.hub.refresh();
  }
  await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.deepEqual(logs.texts(), []);
});

test('a cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.cloud.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  assert.match(logs.lines[0].text, /network error/);

  logs.clear();
  w.cloud.online = true;
  await w.hub.refresh();
  await w.hub.refresh({ force: true });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /reachable again/);
});

test('a rate limit is logged once while it lasts', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.cloud.rateLimitedUntil = w.clock.now() + 30 * 60_000;
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /rate limited/);
});

test('refused credentials are logged once, never the secret', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...CONFIG, client_secret: 'wrong-secret-value' } });
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(31 * 60_000);
    await w.hub.refresh();
  }
  const errors = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(errors.length, 1, logs.texts().join('\n'));
  assert.match(errors[0].text, /refused/);
  assert.ok(!logs.texts().join('\n').includes('wrong-secret-value'));
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w, [SALON]);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.cloud.setValue(SALON, 'co2', 700 + i);
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('LOG_LEVEL=debug shows the details; never the client id, the secret or a token', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  w.cloud.online = false;
  await w.hub.refresh({ force: true });
  await w.hub.refresh({ force: true });
  w.cloud.online = true;
  await w.fake.action('test_connection', {});
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\]/);
  assert.match(text, /still failing/);
  for (const secret of [CLIENT_ID, CLIENT_SECRET, ...w.cloud.tokens, 'fake-access-token']) {
    assert.ok(!text.includes(secret), `never "${secret}" in the logs`);
  }
});
