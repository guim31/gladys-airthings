import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasCredentials, normalizeConfig } from '../src/config.js';

test('defaults: five minutes, 300 Bq/m³, French names, no credentials', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, {
    clientId: '',
    clientSecret: '',
    refreshMs: 5 * 60_000,
    radonReference: 300,
    language: 'fr',
  });
  assert.equal(hasCredentials(config), false);
});

test('values from the form: trimmed credentials, known options only', () => {
  const config = normalizeConfig({
    client_id: '  abc  ',
    client_secret: ' s3cret\n',
    refresh_minutes: 15,
    radon_reference: '100',
    language: 'de',
  });
  assert.equal(config.clientId, 'abc');
  assert.equal(config.clientSecret, 's3cret');
  assert.equal(config.refreshMs, 15 * 60_000);
  assert.equal(config.radonReference, 100);
  assert.equal(config.language, 'de');
  assert.equal(hasCredentials(config), true);

  const odd = normalizeConfig({ refresh_minutes: '1', radon_reference: '250', language: 'it' });
  assert.equal(odd.refreshMs, 5 * 60_000);
  assert.equal(odd.radonReference, 300);
  assert.equal(odd.language, 'fr');
  assert.deepEqual(normalizeConfig(null).clientId, '');
});
