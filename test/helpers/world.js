// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Airthings cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the cloud with `world.hub.refresh()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { CLIENT_ID, CLIENT_SECRET, FakeAirthings } from './fakeAirthings.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const SALON = '2960000001';
export const CHAMBRE = '2930000002';
export const BUREAU = '3210000003';
export const SALLE_DE_BAIN = '2920000004';
export const CAVE = '2950000005';
export const HUB = '2810000006';

export const CONFIG = {
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  language: 'en',
};

/** A manual clock, shared by the hub and the fake cloud. */
export function createClock(start = Date.UTC(2026, 9, 12, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {FakeAirthings} [options.cloud]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  cloud,
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-airthings-')),
  timings = {},
  timers = false,
} = {}) {
  const airthings = cloud ?? new FakeAirthings({ now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: airthings.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, cloud: airthings, app, hub: app.hub, clock, dataDir };
}

/** External ids of a sensor's device. */
export const deviceId = (gladys, serial) => gladys.externalIds('airthings', serial).device;
export const featureId = (gladys, serial, key) =>
  gladys.externalIds('airthings', serial).feature(key);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createAll(world, serials) {
  for (const device of world.fake.discoveredDevices) {
    const serial = device.params.find((p) => p.name === 'AIRTHINGS_SERIAL').value;
    if (!serials || serials.includes(serial)) {
      await world.fake.deviceCreated(device);
    }
  }
}

export { FakeAirthings, CLIENT_ID, CLIENT_SECRET };
