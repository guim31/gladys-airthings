// -----------------------------------------------------------------------------
// From the API answers to records: sensor types, units (metric and the
// imperial example of the API), product names, dates.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseDevice,
  parseRecorded,
  parseSensorResult,
  productName,
} from '../src/airthings/model.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/airthings/${name}.json`, import.meta.url), 'utf8'));

test('a metric reading of a View Plus', async () => {
  const [viewPlus] = (await fixture('sensors')).results;
  const reading = parseSensorResult(viewPlus);
  assert.deepEqual(reading.values, {
    radon_short_term: 45,
    humidity: 40,
    temperature: 21.6,
    co2: 678,
    voc: 234,
    pressure: 1012.3,
    pm25: 3,
    pm1: 2,
  });
  assert.equal(reading.battery, 100);
  assert.equal(reading.recordedAt, Date.UTC(2026, 9, 12, 9, 57, 30));
  assert.deepEqual(reading.ignored, []);
});

test('the imperial example of the API is converted to metric', async () => {
  const [result] = (await fixture('sensors-imperial')).results;
  const { values } = parseSensorResult(result);
  assert.equal(values.radon_short_term, 44); // 1.2 pCi/L × 37
  assert.equal(values.temperature, 20.4); // 68.8 °F
  assert.equal(values.pressure, 781.8); // 78178 Pa
  assert.equal(values.pm25, 0);
});

test('types without a Gladys feature are ignored, an unknown unit drops the value', () => {
  const reading = parseSensorResult({
    serialNumber: '2920000004',
    sensors: [
      { sensorType: 'mold', value: 2, unit: 'riskIndex' },
      { sensorType: 'virusRisk', value: 4, unit: 'riskIndex' },
      { sensorType: 'temp', value: 21, unit: 'kelvin' },
      { sensorType: 'humidity', value: 'n/a', unit: 'pct' },
      { sensorType: 'co2', value: 600 },
      { sensorType: 'radonLongTermAvg', value: 88.4, unit: 'bq' },
      null,
    ],
    recorded: null,
    batteryPercentage: null,
  });
  assert.deepEqual(reading.values, { co2: 600, radon_long_term: 88 });
  assert.deepEqual(reading.ignored, ['mold', 'virusRisk']);
  assert.deepEqual(reading.badUnits, ['temp in kelvin']);
  assert.equal(reading.recordedAt, null);
  assert.equal(reading.battery, null);
});

test('a reading without serial number is dropped; the battery is bounded', () => {
  assert.equal(parseSensorResult({ sensors: [] }), null);
  assert.equal(parseSensorResult({ serialNumber: 'x', batteryPercentage: 104 }).battery, 100);
});

test('devices: the hub has no sensor the integration reads', async () => {
  const devices = (await fixture('devices')).devices.map(parseDevice);
  const hub = devices.find((d) => d.type === 'HUB');
  assert.deepEqual(hub.sensorKeys, []);
  const enhance = devices.find((d) => d.type === 'WAVE_ENHANCE');
  assert.deepEqual(enhance.sensorKeys, [
    'co2',
    'voc',
    'temperature',
    'humidity',
    'pressure',
    'light',
    'noise',
  ]);
  assert.equal(enhance.product, 'Wave Enhance');
  assert.equal(parseDevice({ name: 'no serial' }), null);
});

test('product names', () => {
  assert.equal(productName('VIEW_PLUS'), 'View Plus');
  assert.equal(productName('WAVE_MINI'), 'Wave Mini');
  assert.equal(productName('AP_1'), 'Renew');
  assert.equal(productName('SPACE_NEW_THING'), 'Space New Thing');
  assert.equal(productName(undefined), 'Airthings');
});

test('recorded dates: UTC when the API gives no zone', () => {
  assert.equal(parseRecorded('2025-01-01T12:34:56'), Date.UTC(2025, 0, 1, 12, 34, 56));
  assert.equal(parseRecorded('2025-01-01T12:34:56Z'), Date.UTC(2025, 0, 1, 12, 34, 56));
  assert.equal(parseRecorded('2025-01-01T14:34:56+02:00'), Date.UTC(2025, 0, 1, 12, 34, 56));
  assert.equal(parseRecorded('yesterday'), null);
  assert.equal(parseRecorded(''), null);
});
