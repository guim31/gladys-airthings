// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the examples of the Airthings Consumer API and the answers posted
// in Home Assistant issues): View Plus, Wave Plus, Wave Enhance, Wave Mini,
// Wave Radon, with the sensors the API announces and the ones it really sends,
// before and after a first reading, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUREAU, CAVE, CONFIG, FakeAirthings, createClock, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** Every sensor type the integration reads, sent by the fixtures. */
function fullCloud(now) {
  const cloud = new FakeAirthings({ now });
  cloud.results
    .find((r) => r.serialNumber === CAVE)
    .sensors.push({ sensorType: 'radonLongTermAvg', value: 131, unit: 'bq' });
  cloud.results
    .find((r) => r.serialNumber === BUREAU)
    .sensors.push(
      { sensorType: 'lux', value: 320, unit: 'lux' },
      { sensorType: 'sla', value: 41, unit: 'dba' },
    );
  cloud.devices.push({
    serialNumber: '2980000007',
    name: 'Cuisine',
    type: 'VIEW_POLLUTION',
    sensors: ['temp', 'humidity', 'pm1', 'pm25', 'pm10'],
  });
  cloud.results.push({
    serialNumber: '2980000007',
    sensors: [
      { sensorType: 'temp', value: 20.1, unit: 'c' },
      { sensorType: 'humidity', value: 48, unit: 'pct' },
      { sensorType: 'pm1', value: 4, unit: 'mgpc' },
      { sensorType: 'pm25', value: 6, unit: 'mgpc' },
      { sensorType: 'pm10', value: 9, unit: 'mgpc' },
    ],
    recorded: '2026-10-12T09:58:00',
    batteryPercentage: null,
  });
  return cloud;
}

/** The sensors announced, not read yet: the sensors endpoint refuses. */
function unreadCloud(now) {
  const cloud = new FakeAirthings({ now });
  const original = cloud.request;
  cloud.request = async (url, options) =>
    url.includes('/sensors') ? { status: 503, headers: {}, body: '' } : original(url, options);
  return cloud;
}

const scenarios = [
  { label: 'the fixtures', cloud: (now) => new FakeAirthings({ now }) },
  { label: 'every sensor type', cloud: fullCloud },
  { label: 'before a first reading', cloud: unreadCloud },
  { label: 'French names', cloud: fullCloud, config: { ...CONFIG, language: 'fr' } },
  { label: 'German names', cloud: fullCloud, config: { ...CONFIG, language: 'de' } },
  { label: 'Spanish names', cloud: fullCloud, config: { ...CONFIG, language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const clock = createClock();
    const { gladys, app } = await createWorld({
      clock,
      cloud: scenario.cloud(clock.now),
      config: scenario.config ?? CONFIG,
    });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.ok(devices.length >= 5, `expected the fixture sensors, got ${devices.length}`);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The front names a row after the device when no other feature
          // shares the type (front/src/utils/device.js): "Salon 45 Bq/m³"
          // would not say it is radon.
          assert.ok(
            device.features.filter((other) => other.type === feature.type).length >= 2,
            `${at}: alone of type "${feature.type}" on the device, the front would hide its name`,
          );
        }
      }
    } finally {
      await app.stop();
    }
  });
}
