// -----------------------------------------------------------------------------
// The Consumer API client against the fake Airthings cloud: token, account,
// pagination, refused credentials, expired token, rate limit and own budget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AirthingsClient,
  ERROR_KINDS,
  REQUEST_BUDGET,
  parseRateLimitTime,
  retryAtOf,
} from '../src/airthings/client.js';
import { CLIENT_ID, CLIENT_SECRET, FakeAirthings } from './helpers/fakeAirthings.js';
import { createClock } from './helpers/world.js';

function setup({ clientSecret = CLIENT_SECRET, session, ...cloudOptions } = {}) {
  const clock = createClock();
  const cloud = new FakeAirthings({ now: clock.now, ...cloudOptions });
  const sessions = [];
  const client = new AirthingsClient({
    clientId: CLIENT_ID,
    clientSecret,
    request: cloud.request,
    now: clock.now,
    session,
    onSession: (s) => sessions.push(structuredClone(s)),
  });
  return { clock, cloud, client, sessions };
}

test('the first reading asks a token, the account, then the sensors', async () => {
  const { cloud, client, sessions } = setup();
  const results = await client.getSensors();
  assert.equal(results.length, 5);
  assert.deepEqual(
    cloud.requests.map((r) => r.path),
    [
      '/v1/token',
      '/v1/accounts',
      '/v1/accounts/00000000-0000-4000-8000-000000000001/sensors?unit=metric',
    ],
  );
  assert.equal(sessions.at(-1).accountId, '00000000-0000-4000-8000-000000000001');
  assert.equal(sessions.at(-1).token.type, 'Bearer');
  assert.equal(client.rateLimit.limit, 120);
});

test('the token and the account are reused until the token nears its end', async () => {
  const { clock, cloud, client } = setup();
  await client.getSensors();
  await client.getDevices();
  await client.getSensors();
  assert.equal(cloud.count('/v1/token'), 1);
  assert.equal(cloud.requests.filter((r) => r.path === '/v1/accounts').length, 1);
  clock.advance(3 * 60 * 60_000 - 4 * 60_000); // 4 minutes before the end
  await client.getSensors();
  assert.equal(cloud.count('/v1/token'), 2, 'renewed ahead of its expiry');
});

test('a saved session spares the token and account requests', async () => {
  const first = setup();
  await first.client.getSensors();
  const session = first.client.session;
  const clock = createClock();
  const cloud = new FakeAirthings({ now: clock.now });
  cloud.tokens = first.cloud.tokens;
  const client = new AirthingsClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    request: cloud.request,
    now: clock.now,
    session,
  });
  await client.getSensors();
  assert.deepEqual(
    cloud.requests.map((r) => r.path),
    ['/v1/accounts/00000000-0000-4000-8000-000000000001/sensors?unit=metric'],
  );
});

test('a refused token is renewed once, then the request is replayed', async () => {
  const { cloud, client } = setup();
  await client.getSensors();
  cloud.revokeTokens();
  const results = await client.getSensors();
  assert.equal(results.length, 5);
  assert.equal(cloud.count('/v1/token'), 2);
});

test('refused credentials are an AUTH error, without the secret in the message', async () => {
  const { client } = setup({ clientSecret: 'wrong-secret-value' });
  await assert.rejects(client.getSensors(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.equal(err.status, 401);
    assert.ok(!err.message.includes('wrong-secret-value'));
    assert.ok(!err.message.includes(CLIENT_ID));
    return true;
  });
});

test('the token request uses HTTP Basic credentials and a JSON body', async () => {
  const { cloud, client } = setup();
  const seen = [];
  const original = cloud.request;
  client.request = async (url, options) => {
    seen.push({ url, options });
    return original(url, options);
  };
  await client.getSensors();
  const token = seen[0];
  assert.equal(token.url, 'https://accounts-api.airthings.com/v1/token');
  assert.equal(token.options.method, 'POST');
  assert.equal(
    token.options.headers.authorization,
    `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
  );
  assert.deepEqual(JSON.parse(token.options.body), { grant_type: 'client_credentials' });
  assert.match(seen[1].options.headers.authorization, /^Bearer fake-access-token-\d+$/);
});

test('every page of sensors is read', async () => {
  const { cloud, client } = setup({ pageSize: 2 });
  const results = await client.getSensors();
  assert.equal(results.length, 5);
  assert.equal(cloud.count('/sensors'), 3);
  assert.equal(cloud.count('pageNumber=3'), 1);
});

test('a 429 pauses every request until the time the API gives', async () => {
  const { clock, cloud, client } = setup();
  await client.getSensors();
  cloud.rateLimitedUntil = clock.now() + 20 * 60_000;
  await assert.rejects(client.getSensors(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.RATE_LIMIT);
    assert.equal(err.retryAt, clock.now() + 20 * 60_000);
    return true;
  });
  const before = cloud.requests.length;
  clock.advance(10 * 60_000);
  await assert.rejects(client.getSensors(), { kind: ERROR_KINDS.RATE_LIMIT });
  assert.equal(cloud.requests.length, before, 'nothing sent while paused');
  clock.advance(10 * 60_000);
  assert.equal((await client.getSensors()).length, 5);
});

test('the own budget stops below the quota of 120 requests an hour', async () => {
  const { clock, cloud, client } = setup();
  for (let i = 0; i < REQUEST_BUDGET - 2; i += 1) {
    await client.getSensors();
  }
  assert.equal(client.requestsLastHour(), REQUEST_BUDGET);
  assert.equal(client.canSend(1), false);
  await assert.rejects(client.getSensors(), { kind: ERROR_KINDS.RATE_LIMIT });
  assert.equal(cloud.requests.length, REQUEST_BUDGET);
  clock.advance(60 * 60_000 + 1);
  assert.equal(client.canSend(1), true);
  await client.getSensors();
});

test('network failures and server errors have their own kinds', async () => {
  const { cloud, client } = setup();
  cloud.online = false;
  await assert.rejects(client.getSensors(), { kind: ERROR_KINDS.UNREACHABLE });
  cloud.online = true;
  cloud.serverError = 503;
  await assert.rejects(client.getSensors(), { kind: ERROR_KINDS.SERVER, status: 503 });
});

test('an answer that is not JSON, or without a list, is a PROTOCOL error', async () => {
  const { client } = setup();
  const original = client.request;
  client.request = async (url, options) =>
    url.includes('/sensors')
      ? { status: 200, headers: {}, body: '<html>' }
      : original(url, options);
  await assert.rejects(client.getSensors(), { kind: ERROR_KINDS.PROTOCOL });
  client.request = async (url, options) =>
    url.includes('/devices') ? { status: 200, headers: {}, body: '{}' } : original(url, options);
  await assert.rejects(client.getDevices(), { kind: ERROR_KINDS.PROTOCOL });
});

test('an API client without account is a NO_ACCOUNT error', async () => {
  const { client } = setup();
  const original = client.request;
  client.request = async (url, options) =>
    url.endsWith('/v1/accounts')
      ? { status: 200, headers: {}, body: '{"accounts":[]}' }
      : original(url, options);
  await assert.rejects(client.getDevices(), { kind: ERROR_KINDS.NO_ACCOUNT });
});

test('rate-limit times: seconds, Unix seconds, Unix milliseconds, dates', () => {
  const now = Date.UTC(2026, 9, 12, 10, 0, 0);
  assert.equal(parseRateLimitTime('90', now), now + 90_000);
  assert.equal(parseRateLimitTime(String(now / 1000 + 600), now), now + 600_000);
  assert.equal(parseRateLimitTime(String(now + 600_000), now), now + 600_000);
  assert.equal(parseRateLimitTime(new Date(now + 60_000).toUTCString(), now), now + 60_000);
  assert.equal(parseRateLimitTime('', now), null);
  assert.equal(parseRateLimitTime('soon', now), null);
  // Bounded: one minute to one hour, 15 minutes without a header.
  assert.equal(retryAtOf({}, now), now + 15 * 60_000);
  assert.equal(retryAtOf({ 'x-ratelimit-retry-after': '5' }, now), now + 60_000);
  assert.equal(retryAtOf({ 'retry-after': '86400' }, now), now + 60 * 60_000);
});
