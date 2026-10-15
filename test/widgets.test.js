// -----------------------------------------------------------------------------
// The `air_quality` widget: both views, every language, validated with the
// SDK's copy of the core rules (vocabulary, bounds, budget), the radon colour
// code, and the empty and degraded states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildDevice } from '../src/devices.js';
import { WIDGET_KEY } from '../src/hub.js';
import {
  CAVE,
  CHAMBRE,
  CONFIG,
  FakeAirthings,
  SALON,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, { settings = {}, language = 'en' } = {}) {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const issues = validateWidgetContent(ack.data.content);
  assert.deepEqual(issues, [], `${language} ${JSON.stringify(settings)}`);
  return ack.data.content;
}

const ofType = (c, type) => c.components.filter((component) => component.type === type);

test('every room: one row each, the rooms that need attention first', async (t) => {
  const w = await world(t);
  for (const language of LANGS) {
    const c = await content(w, { language });
    const [status] = ofType(c, 'status');
    assert.equal(status.items.length, 5);
    for (const item of status.items) {
      assert.ok(item.value.length <= 40, item.value);
    }
  }
  const c = await content(w, { language: 'fr' });
  const [status] = ofType(c, 'status');
  const row = (label) => status.items.find((item) => item.label === label);
  assert.equal(row('Chambre').color, 'danger', '312 Bq/m³ is above 300');
  assert.equal(row('Salon').color, 'success');
  assert.equal(row('Bureau').color, 'warning', 'humidity 29 %');
  assert.equal(row('Salon').value, '45 Bq/m³ · 678 ppm · 3 µg/m³ · 21,6 °C');
  assert.equal(status.items.at(-1).label, 'Salon', 'the good room last');
  const [radonMax, co2Max] = ofType(c, 'value');
  assert.deepEqual(
    [radonMax.value, radonMax.color, co2Max.value, co2Max.color],
    [312, 'danger', 1120, 'danger'],
  );
  assert.match(ofType(c, 'text')[0].text, /300 Bq\/m³/);
});

test('one sensor: five tiles, the radon verdict, the age; the curve once the device is added', async (t) => {
  const w = await world(t);
  const settings = { device: deviceId(w.gladys, CHAMBRE) };
  for (const language of LANGS) {
    const c = await content(w, { settings, language });
    assert.equal(ofType(c, 'value').length, 5);
    assert.equal(ofType(c, 'chart').length, 0, 'not added yet: no history to draw');
  }
  await createAll(w, [CHAMBRE]);
  for (const language of LANGS) {
    const c = await content(w, { settings, language });
    assert.ok(c.components.length <= 8);
    const [chart] = ofType(c, 'chart');
    assert.deepEqual(chart.device_features, [featureId(w.gladys, CHAMBRE, 'radon_short_term')]);
    // The ids the widget binds exist on the device it publishes.
    const device = buildDevice(w.gladys, w.hub.records.get(CHAMBRE), language);
    assert.ok(device.features.some((f) => f.external_id === chart.device_features[0]));
  }
  const c = await content(w, { settings, language: 'fr' });
  const tiles = ofType(c, 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.label),
    ['Radon', 'CO₂', 'Température', 'Humidité', 'COV'],
  );
  assert.equal(tiles[0].color, 'danger');
  const [status] = ofType(c, 'status');
  assert.deepEqual(status.items[0], {
    label: 'Niveau de radon',
    icon: 'alert-circle',
    value: 'Au-dessus de la référence (300 Bq/m³)',
    color: 'danger',
  });
  assert.equal(status.items.at(-1).value, 'il y a 5 min');
});

test('the radon colour follows the reference level of the configuration', async (t) => {
  const w = await world(t, { config: { ...CONFIG, radon_reference: '100' } });
  const c = await content(w, { settings: { device: deviceId(w.gladys, CAVE) } });
  assert.equal(ofType(c, 'value')[0].color, 'danger', '150 Bq/m³ above 100');
  const w300 = await world(t);
  const c300 = await content(w300, { settings: { device: deviceId(w300.gladys, CAVE) } });
  assert.equal(ofType(c300, 'value')[0].color, 'warning', '150 Bq/m³: between 100 and 300');
  const salon = await content(w300, { settings: { device: deviceId(w300.gladys, SALON) } });
  assert.equal(ofType(salon, 'value')[0].color, 'success');
});

test('a sensor that stopped uploading: no tile, the age in warning', async (t) => {
  const w = await world(t);
  w.clock.advance(5 * 60 * 60_000);
  await w.hub.refresh();
  const c = await content(w, { settings: { device: deviceId(w.gladys, SALON) }, language: 'en' });
  assert.equal(ofType(c, 'value').length, 0);
  const [status] = ofType(c, 'status');
  assert.deepEqual(status.items.at(-1), {
    label: 'Last measurement',
    icon: 'clock',
    value: '5 h ago',
    color: 'warning',
  });
  const house = await content(w, { language: 'en' });
  assert.ok(
    ofType(house, 'status')[0].items.every((item) => item.value === 'No recent measurement'),
  );
});

test('empty and degraded states', async (t) => {
  const empty = await world(t, { config: {} });
  assert.match(ofType(await content(empty), 'text')[0].text, /client id and secret/);

  const none = await world(t, { cloud: new FakeAirthings({ devices: [], results: [] }) });
  assert.match(ofType(await content(none), 'text')[0].text, /no sensor/);

  const w = await world(t);
  const gone = await content(w, { settings: { device: 'ext:test-integration:airthings:999' } });
  assert.match(ofType(gone, 'text')[0].text, /no longer in the Airthings account/);

  w.cloud.online = false;
  await w.hub.refresh();
  for (const language of LANGS) {
    const c = await content(w, { language });
    assert.equal(ofType(c, 'text').filter((x) => x.variant === 'body').length, 1);
  }
  const c = await content(w, { language: 'fr' });
  assert.equal(
    ofType(c, 'text').find((x) => x.variant === 'body').text,
    'Cloud Airthings : le cloud Airthings ne répond pas.',
  );
  assert.equal(ofType(c, 'status')[0].items.length, 5, 'the last values stay shown');

  const refused = await world(t, { config: { ...CONFIG, client_secret: 'wrong' } });
  const r = await content(refused);
  assert.match(ofType(r, 'text')[0].text, /refused/);
});
