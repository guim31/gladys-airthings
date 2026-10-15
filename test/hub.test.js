// -----------------------------------------------------------------------------
// The hub against the fake Airthings cloud and the SDK's fake Gladys:
// discovery, states (changes only, heartbeat, stale readings), devices added
// later, onPoll fallback, account changes, persistence, connection status,
// transports, scan request.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { HUB_TIMINGS } from '../src/hub.js';
import {
  BUREAU,
  CAVE,
  CHAMBRE,
  CLIENT_SECRET,
  CONFIG,
  FakeAirthings,
  HUB,
  SALON,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

const names = (device) => device.features.map((f) => f.external_id.split(':').pop());
const statesFor = (fake, externalId) =>
  fake.states.filter((s) => s.device_feature_external_id === externalId);

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('one device per sensor, the hub left out, the features the sensor really sends', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.equal(devices.length, 5);
  assert.ok(!devices.some((d) => d.external_id === deviceId(w.gladys, HUB)));
  const salon = devices.find((d) => d.external_id === deviceId(w.gladys, SALON));
  assert.equal(salon.name, 'Salon');
  assert.deepEqual(names(salon), [
    'radon_short_term',
    'co2',
    'voc',
    'pm1',
    'pm25',
    'temperature',
    'humidity',
    'pressure',
    'battery',
    'measurement_age',
  ]);
  assert.deepEqual(salon.params, [
    { name: 'AIRTHINGS_SERIAL', value: SALON },
    { name: 'AIRTHINGS_MODEL', value: 'View Plus' },
  ]);
  assert.equal(salon.should_poll, true);
  assert.equal(salon.poll_frequency, DEVICE_POLL_FREQUENCIES.EVERY_MINUTES);
  // Announces light and noise, sends neither (home-assistant/core#140845).
  const bureau = devices.find((d) => d.external_id === deviceId(w.gladys, BUREAU));
  assert.ok(!names(bureau).includes('light') && !names(bureau).includes('noise'));
});

test('the radon long-term average becomes a feature when the API sends it', async (t) => {
  const clock = createClock();
  const cloud = new FakeAirthings({ now: clock.now });
  cloud.results
    .find((r) => r.serialNumber === CAVE)
    .sensors.push({ sensorType: 'radonLongTermAvg', value: 131, unit: 'bq' });
  const w = await world(t, { clock, cloud });
  await createAll(w, [CAVE]);
  const cave = w.fake.discoveredDevices.find((d) => d.external_id === deviceId(w.gladys, CAVE));
  assert.ok(names(cave).includes('radon_long_term'));
  assert.equal(w.fake.lastState(featureId(w.gladys, CAVE, 'radon_long_term')), 131);
});

test('states go to the devices added to Gladys only, from the last reading', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0, 'nothing added yet: nothing sent');
  const before = w.cloud.requests.length;
  await createAll(w, [SALON]);
  assert.equal(w.cloud.requests.length, before, 'no request to add a device');
  assert.equal(w.fake.lastState(featureId(w.gladys, SALON, 'radon_short_term')), 45);
  assert.equal(w.fake.lastState(featureId(w.gladys, SALON, 'co2')), 678);
  assert.equal(w.fake.lastState(featureId(w.gladys, SALON, 'pressure')), 1012.3);
  assert.equal(w.fake.lastState(featureId(w.gladys, SALON, 'battery')), 100);
  assert.equal(w.fake.lastState(featureId(w.gladys, SALON, 'measurement_age')), 3);
  assert.equal(w.fake.lastState(featureId(w.gladys, CHAMBRE, 'co2')), undefined);
  assert.ok(w.fake.widgetRefreshes.includes('air_quality'));
});

test('only the changes are published, and every value again after the heartbeat', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 12, 10, 0, 0) });
  const clock = { now: () => Date.now(), advance: (ms) => t.mock.timers.tick(ms) };
  const w = await world(t, { clock, cloud: new FakeAirthings({ now: clock.now }) });
  await createAll(w, [SALON]);
  const co2 = featureId(w.gladys, SALON, 'co2');
  const radon = featureId(w.gladys, SALON, 'radon_short_term');
  assert.equal(statesFor(w.fake, co2).length, 1);

  // Same reading five minutes later: the age changes, nothing else.
  clock.advance(5 * 60_000);
  await w.hub.refresh();
  assert.equal(statesFor(w.fake, co2).length, 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, SALON, 'measurement_age')), 8);

  // A new measurement.
  w.cloud.setValue(SALON, 'co2', 910);
  w.cloud.setRecorded(SALON, clock.now() - 60_000);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(co2), 910);
  assert.equal(statesFor(w.fake, radon).length, 1, 'unchanged radon not sent again');

  // Six hours of identical readings: the heartbeat sends the radon again.
  for (let i = 0; i < 6 * 12; i += 1) {
    clock.advance(5 * 60_000);
    w.cloud.setRecorded(SALON, clock.now() - 60_000);
    await w.hub.refresh();
  }
  assert.ok(HUB_TIMINGS.heartbeatMs <= 12 * 60 * 60_000);
  assert.equal(statesFor(w.fake, radon).length, 2, 'heartbeat after 6 h');
});

test('a sensor that stopped uploading: no stale value republished, the age grows, unreachable', async (t) => {
  const w = await world(t);
  await createAll(w, [SALON]);
  const radon = featureId(w.gladys, SALON, 'radon_short_term');
  w.clock.advance(4 * 60 * 60_000); // the recorded date stays at 09:57
  await w.hub.refresh();
  w.clock.advance(HUB_TIMINGS.heartbeatMs);
  await w.hub.refresh();
  assert.equal(statesFor(w.fake, radon).length, 1, 'the old value is not made to look fresh');
  assert.ok(w.fake.lastState(featureId(w.gladys, SALON, 'measurement_age')) > 10 * 60);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys, SALON),
    transport: 'unreachable',
  });
});

test('transports: cloud while the readings are fresh, unreachable when the cloud is down', async (t) => {
  const w = await world(t);
  await createAll(w, [SALON]);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys, SALON),
    transport: 'cloud',
  });
  w.cloud.online = false;
  await w.hub.refresh();
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  w.cloud.online = true;
  await w.hub.refresh();
  assert.equal(w.fake.transports.at(-1).transport, 'cloud');
});

test('onPoll is a fallback: no request within 90 % of the period', async (t) => {
  const w = await world(t);
  await createAll(w, [SALON]);
  const [device] = w.fake.discoveredDevices;
  const before = w.cloud.count('/sensors');
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(60_000);
    assert.equal((await w.fake.poll(device)).success, true);
  }
  assert.equal(w.cloud.count('/sensors'), before, 'four minutes of onPoll: no request');
  w.clock.advance(60_000);
  await w.fake.poll(device);
  assert.equal(w.cloud.count('/sensors'), before + 1, 'past 90 % of five minutes: one reading');
  await Promise.all(w.fake.discoveredDevices.map((d) => w.fake.poll(d)));
  assert.equal(w.cloud.count('/sensors'), before + 1, 'one reading for the whole account');
});

test('the device list is read once an hour, and again for an unknown serial number', async (t) => {
  const w = await world(t);
  assert.equal(w.cloud.count('/devices'), 1);
  w.clock.advance(30 * 60_000);
  await w.hub.refresh();
  assert.equal(w.cloud.count('/devices'), 1);
  w.clock.advance(31 * 60_000);
  await w.hub.refresh();
  assert.equal(w.cloud.count('/devices'), 2);

  // A sensor registered meanwhile: it shows up in the sensors first.
  w.cloud.devices.push({
    serialNumber: '2980000007',
    name: 'Cuisine',
    type: 'VIEW_POLLUTION',
    sensors: ['temp', 'humidity', 'pm1', 'pm25'],
  });
  w.cloud.results.push({
    serialNumber: '2980000007',
    sensors: [
      { sensorType: 'pm25', value: 12, unit: 'mgpc' },
      { sensorType: 'temp', value: 20, unit: 'c' },
    ],
    recorded: '2026-10-12T11:00:00',
  });
  w.clock.advance(11 * 60_000);
  await w.hub.refresh();
  assert.equal(w.cloud.count('/devices'), 3);
  const kitchen = w.fake.discoveredDevices.find((d) => d.name === 'Cuisine');
  assert.ok(kitchen, 'published in the Discovery tab');
  assert.deepEqual(names(kitchen), ['pm25', 'temperature', 'measurement_age']);
});

test('the hub, which has no reading, does not make the device list re-read', async (t) => {
  const w = await world(t);
  w.cloud.results.push({ serialNumber: HUB, sensors: [], recorded: null });
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(11 * 60_000);
    await w.hub.refresh();
  }
  assert.equal(w.cloud.count('/devices'), 1);
});

test('"Search" in the Discovery tab reads the device list again', async (t) => {
  const w = await world(t);
  w.cloud.devices.find((d) => d.serialNumber === SALON).name = 'Séjour';
  await w.fake.scanRequest();
  assert.equal(w.cloud.count('/devices'), 2);
  const salon = w.fake.discoveredDevices.find((d) => d.external_id === deviceId(w.gladys, SALON));
  assert.equal(salon.name, 'Séjour', 'renamed, same external id');
});

test('a sensor removed from the account leaves the Discovery tab', async (t) => {
  const w = await world(t);
  w.cloud.devices = w.cloud.devices.filter((d) => d.serialNumber !== CAVE);
  w.cloud.results = w.cloud.results.filter((r) => r.serialNumber !== CAVE);
  await w.fake.scanRequest();
  assert.equal(w.fake.discoveredDevices.length, 4);
});

test('the discovery list is published only when it changes', async (t) => {
  const w = await world(t);
  const published = () =>
    w.fake.requests.filter((r) => r.method === 'POST' && r.path.includes('discovered')).length;
  const before = published();
  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
  }
  assert.equal(published(), before);
});

test('the token and account survive a restart: no new token request', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'airthings-state.json'), 'utf8'));
  assert.equal(typeof saved.token.value, 'string');
  assert.ok(!JSON.stringify(saved).includes(CLIENT_SECRET), 'never the secret');
  assert.equal((await stat(join(first.dataDir, 'airthings-state.json'))).mode & 0o777, 0o600);

  const cloud = new FakeAirthings({ now: first.clock.now });
  cloud.tokens = first.cloud.tokens;
  const second = await world(t, { clock: first.clock, cloud, dataDir: first.dataDir });
  assert.equal(cloud.count('/v1/token'), 0);
  assert.equal(cloud.requests.filter((r) => r.path === '/v1/accounts').length, 0);
  assert.equal(second.fake.discoveredDevices.length, 5);
});

test('new credentials: the saved token is not reused', async (t) => {
  const w = await world(t);
  w.cloud.clientSecret = 'another-secret';
  await w.fake.configUpdated({ ...CONFIG, client_secret: 'another-secret' });
  assert.equal(w.cloud.count('/v1/token'), 2);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('the connection status: no credentials, refused, rate limited, no sensor', async (t) => {
  const empty = await world(t, { config: {} });
  assert.equal(empty.fake.connectionStatus.connected, false);
  assert.match(empty.fake.connectionStatus.message.en, /client id and secret/);
  assert.equal(empty.cloud.requests.length, 0, 'nothing sent without credentials');

  const refused = await world(t, { config: { ...CONFIG, client_secret: 'wrong' } });
  assert.equal(refused.fake.connectionStatus.connected, false);
  assert.match(refused.fake.connectionStatus.message.fr, /refusé/);

  const limited = await world(t);
  limited.cloud.rateLimitedUntil = limited.clock.now() + 30 * 60_000;
  await limited.hub.refresh();
  assert.equal(limited.fake.connectionStatus.connected, true, 'still connected, only waiting');
  assert.match(limited.fake.connectionStatus.message.en, /quota/);
  limited.clock.advance(31 * 60_000);
  limited.cloud.rateLimitedUntil = 0;
  await limited.hub.refresh();
  assert.equal(limited.fake.connectionStatus.message, undefined);

  const cloud = new FakeAirthings({ devices: [], results: [] });
  const none = await world(t, { cloud });
  assert.equal(none.fake.connectionStatus.connected, true);
  assert.match(none.fake.connectionStatus.message.en, /no sensor/);
});

test('"Test the connection" reads the account and reports the sensors and the quota', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /^Connecté : 5 capteur\(s\) \(Salon, Chambre/);
  assert.match(ack.data.message.en, /API requests this hour: \d+ of 120\./);
  for (const text of Object.values(ack.data.message)) {
    assert.ok(text.length <= 200, text);
  }
  w.cloud.online = false;
  const failed = await w.fake.action('test_connection', {});
  assert.match(
    failed.data.message.en,
    /^Connection failed: the Airthings cloud does not answer\.$/,
  );
});

test('Gladys reconnecting gets the discovery and the states again, without a new reading', async (t) => {
  const w = await world(t);
  await createAll(w, [SALON]);
  const co2 = featureId(w.gladys, SALON, 'co2');
  const before = statesFor(w.fake, co2).length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(statesFor(w.fake, co2).length, before + 1);
});

test('credentials changed during a reading: nothing of the old account is kept', async (t) => {
  const w = await world(t);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = w.cloud.request;
  let held = false;
  w.cloud.request = async (url, options) => {
    if (!held && url.includes('/devices')) {
      held = true;
      await gate;
    }
    return original(url, options);
  };
  w.app.hub.request = w.cloud.request;
  w.hub.client.request = w.cloud.request;
  w.clock.advance(61 * 60_000);
  const reading = w.hub.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  // The other account has a single sensor.
  w.cloud.clientSecret = 'other-account-secret';
  w.cloud.devices = w.cloud.devices.filter((d) => d.serialNumber === CAVE);
  w.cloud.results = w.cloud.results.filter((r) => r.serialNumber === CAVE);
  const reconfigured = w.fake.configUpdated({ ...CONFIG, client_secret: 'other-account-secret' });
  release();
  await reading;
  await reconfigured;
  assert.deepEqual([...w.hub.records.keys()], [CAVE]);
  assert.equal(w.fake.discoveredDevices.length, 1);
});
