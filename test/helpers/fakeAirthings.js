// -----------------------------------------------------------------------------
// An in-memory Airthings cloud: the token endpoint and the Consumer API, with
// the fixtures of test/fixtures/airthings as content. It answers the `request`
// seam of the client (src/airthings/http.js) and records every request.
//
// Knobs: `online` (false: network error), `rateLimitedUntil` (429 with
// X-RateLimit-Retry-After), `serverError` (an HTTP status for the API
// calls), `revokeTokens()` (the next API call gets a 401), `pageSize`.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const CLIENT_ID = 'fake-client-id-0123';
export const CLIENT_SECRET = 'fake-client-secret-4567';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/airthings/${name}.json`, import.meta.url), 'utf8'));

const json = (status, data, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(data),
});

export class FakeAirthings {
  constructor({
    now = () => Date.now(),
    clientId = CLIENT_ID,
    clientSecret = CLIENT_SECRET,
    devices = fixture('devices').devices,
    results = fixture('sensors').results,
    tokenLifetime = 10_800,
    pageSize = 50,
  } = {}) {
    this.now = now;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.devices = structuredClone(devices);
    this.results = structuredClone(results);
    this.accountId = fixture('accounts').accounts[0].id;
    this.tokenLifetime = tokenLifetime;
    this.pageSize = pageSize;
    this.online = true;
    this.rateLimitedUntil = 0;
    this.serverError = null;
    this.tokens = new Set();
    this.issued = 0;
    /** @type {Array<{ method: string, path: string, at: number }>} */
    this.requests = [];
    this.request = this.request.bind(this);
  }

  /** Paths requested, e.g. `count('/sensors')`. */
  count(fragment) {
    return this.requests.filter((r) => r.path.includes(fragment)).length;
  }

  revokeTokens() {
    this.tokens.clear();
  }

  /** Set a sensor value of a result (`setValue('2960000001', 'co2', 900)`). */
  setValue(serial, sensorType, value) {
    const result = this.results.find((r) => r.serialNumber === serial);
    const sensor = result.sensors.find((s) => s.sensorType === sensorType);
    sensor.value = value;
  }

  /** The `recorded` date of a result, as the API writes it (UTC, no zone). */
  setRecorded(serial, epochMs) {
    const result = this.results.find((r) => r.serialNumber === serial);
    result.recorded = new Date(epochMs).toISOString().slice(0, 19);
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(url);
    this.requests.push({ method, path: `${target.pathname}${target.search}`, at: this.now() });
    if (!this.online) {
      const error = new TypeError('fetch failed');
      throw error;
    }
    if (this.now() < this.rateLimitedUntil) {
      return json(429, fixture('rate-limit'), {
        'x-ratelimit-retry-after': String(Math.ceil((this.rateLimitedUntil - this.now()) / 1000)),
      });
    }
    if (target.host === 'accounts-api.airthings.com') {
      return this.token(target, method, headers, body);
    }
    if (target.host !== 'consumer-api.airthings.com') {
      throw new TypeError('fetch failed');
    }
    const auth = headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token || !this.tokens.has(token)) {
      return json(401, { message: 'Unauthorized' });
    }
    if (this.serverError) {
      return json(this.serverError, { message: 'Internal error' });
    }
    const path = target.pathname;
    if (path === '/v1/accounts') {
      return json(200, { accounts: [{ id: this.accountId }] });
    }
    if (path === `/v1/accounts/${this.accountId}/devices`) {
      return json(200, { devices: this.devices });
    }
    if (path === `/v1/accounts/${this.accountId}/sensors`) {
      const page = Number(target.searchParams.get('pageNumber') ?? 1);
      const totalPages = Math.max(1, Math.ceil(this.results.length / this.pageSize));
      const slice = this.results.slice((page - 1) * this.pageSize, page * this.pageSize);
      const used = this.requests.filter((r) => r.at > this.now() - 3_600_000).length;
      return json(
        200,
        { results: slice, hasNext: page < totalPages, totalPages },
        {
          'x-ratelimit-limit': '120',
          'x-ratelimit-remaining': String(Math.max(0, 120 - used)),
          'x-ratelimit-reset': String(Math.floor((this.now() + 3_600_000) / 1000)),
        },
      );
    }
    return json(404, { message: 'Not found' });
  }

  token(target, method, headers, body) {
    if (target.pathname !== '/v1/token' || method !== 'POST') {
      return json(404, { message: 'Not found' });
    }
    const expected = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
    let grant;
    try {
      grant = JSON.parse(body).grant_type;
    } catch {
      grant = null;
    }
    if (grant !== 'client_credentials') {
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (headers.authorization !== expected) {
      return json(401, { error: 'invalid_client' });
    }
    this.issued += 1;
    const token = `fake-access-token-${this.issued}`;
    this.tokens.add(token);
    return json(200, { access_token: token, token_type: 'Bearer', expires_in: this.tokenLifetime });
  }
}
