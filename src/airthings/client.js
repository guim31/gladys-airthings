// -----------------------------------------------------------------------------
// Client of the Airthings Consumer API (https://consumer-api-doc.airthings.com,
// OpenAPI specification vendored by michaelahern/airthings-consumer-api, ISC):
//
//   POST https://accounts-api.airthings.com/v1/token     OAuth client credentials
//   GET  https://consumer-api.airthings.com/v1/accounts  the account id (constant)
//   GET  …/v1/accounts/{accountId}/devices               names, types, sensor lists
//   GET  …/v1/accounts/{accountId}/sensors?unit=metric   latest values, 50 devices a page
//
// The token request follows the client library above (HTTP Basic credentials,
// JSON body), which runs in production in homebridge-airthings.
//
// Quota: 120 requests per hour per API client. The client counts its own
// requests over a sliding hour and stops at REQUEST_BUDGET, below the quota:
// the same API client may also serve a script or another tool of the user.
// A 429 answer stops every request until the time the API gives.
//
// Errors carry a `kind` (ERROR_KINDS) and never the credentials, the token
// or the body of an answer.
// -----------------------------------------------------------------------------

export const TOKEN_URL = 'https://accounts-api.airthings.com/v1/token';
export const API_URL = 'https://consumer-api.airthings.com/v1';

export const ERROR_KINDS = Object.freeze({
  AUTH: 'auth', // client id or secret refused
  RATE_LIMIT: 'rate_limit', // 429, or the own budget spent
  UNREACHABLE: 'unreachable', // network error, timeout
  SERVER: 'server', // 5xx
  PROTOCOL: 'protocol', // an answer this client does not understand
  NO_ACCOUNT: 'no_account', // the API client sees no account
});

export const API_QUOTA_PER_HOUR = 120;
export const REQUEST_BUDGET = 100;
const HOUR_MS = 60 * 60_000;
// A token is renewed this long before it expires.
const TOKEN_MARGIN_MS = 5 * 60_000;
// Bounds of the pause after a 429.
const MIN_RATE_LIMIT_PAUSE_MS = 60_000;
const MAX_RATE_LIMIT_PAUSE_MS = HOUR_MS;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 15 * 60_000;
// Safety net against a pagination that never ends.
const MAX_PAGES = 20;

export class AirthingsError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {{ status?: number, retryAt?: number }} [details]
   */
  constructor(kind, message, { status, retryAt } = {}) {
    super(message);
    this.name = 'AirthingsError';
    this.kind = kind;
    this.status = status;
    this.retryAt = retryAt;
  }
}

/**
 * A time given by a rate-limit header: seconds to wait, a Unix timestamp in
 * seconds or milliseconds, or a date. The OpenAPI specification calls the 429
 * header "number of seconds" with a timestamp format: both are accepted.
 * @returns {number|null} epoch milliseconds
 */
export function parseRateLimitTime(raw, now) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const text = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (number < 1e9) {
      return now + number * 1000;
    }
    return number < 1e12 ? number * 1000 : number;
  }
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : date;
}

/** When requests may resume after a 429. */
export function retryAtOf(headers, now) {
  const at =
    parseRateLimitTime(headers['x-ratelimit-retry-after'], now) ??
    parseRateLimitTime(headers['retry-after'], now) ??
    parseRateLimitTime(headers['x-ratelimit-reset'], now) ??
    now + DEFAULT_RATE_LIMIT_PAUSE_MS;
  return Math.min(Math.max(at, now + MIN_RATE_LIMIT_PAUSE_MS), now + MAX_RATE_LIMIT_PAUSE_MS);
}

function parseJson(body, what) {
  try {
    return JSON.parse(body);
  } catch {
    throw new AirthingsError(ERROR_KINDS.PROTOCOL, `${what}: the answer is not JSON`);
  }
}

export class AirthingsClient {
  /**
   * @param {object} options
   * @param {string} options.clientId
   * @param {string} options.clientSecret
   * @param {Function} options.request HTTP seam (src/airthings/http.js)
   * @param {() => number} [options.now]
   * @param {{ token?: object, accountId?: string }} [options.session] saved by a previous run
   * @param {(session: object) => void} [options.onSession] called when the token or account id change
   */
  constructor({
    clientId,
    clientSecret,
    request,
    now = () => Date.now(),
    session = {},
    onSession,
  }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.request = request;
    this.now = now;
    this.token = validToken(session.token) ? session.token : null;
    this.accountId = typeof session.accountId === 'string' ? session.accountId : null;
    this.onSession = onSession ?? (() => {});
    /** Start times of the requests of the last hour. */
    this.sent = [];
    /** Epoch ms before which no request is sent (after a 429). */
    this.pausedUntil = 0;
    /** The last rate-limit headers of the API: { limit, remaining, resetAt }. */
    this.rateLimit = null;
  }

  get session() {
    return { token: this.token, accountId: this.accountId };
  }

  /** Requests sent over the last hour. */
  requestsLastHour() {
    const since = this.now() - HOUR_MS;
    this.sent = this.sent.filter((at) => at > since);
    return this.sent.length;
  }

  /** Whether `count` more requests fit in the budget now. */
  canSend(count = 1) {
    return this.now() >= this.pausedUntil && this.requestsLastHour() + count <= REQUEST_BUDGET;
  }

  /** Throws a RATE_LIMIT error when no request may be sent now. */
  checkBudget() {
    const now = this.now();
    if (now < this.pausedUntil) {
      throw new AirthingsError(ERROR_KINDS.RATE_LIMIT, 'Airthings rate limit: waiting', {
        retryAt: this.pausedUntil,
      });
    }
    if (this.requestsLastHour() >= REQUEST_BUDGET) {
      throw new AirthingsError(
        ERROR_KINDS.RATE_LIMIT,
        `Request budget spent (${REQUEST_BUDGET} per hour)`,
        { retryAt: this.sent[0] + HOUR_MS },
      );
    }
  }

  /** One counted request. Network failures become UNREACHABLE errors. */
  async send(url, options, what) {
    this.checkBudget();
    this.sent.push(this.now());
    let response;
    try {
      response = await this.request(url, options);
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timed out' : 'network error';
      throw new AirthingsError(ERROR_KINDS.UNREACHABLE, `${what}: ${reason}`);
    }
    const headers = response.headers ?? {};
    if (response.status === 429) {
      this.pausedUntil = retryAtOf(headers, this.now());
      throw new AirthingsError(ERROR_KINDS.RATE_LIMIT, `${what}: rate limited (HTTP 429)`, {
        status: 429,
        retryAt: this.pausedUntil,
      });
    }
    if (headers['x-ratelimit-limit'] !== undefined) {
      this.rateLimit = {
        limit: Number(headers['x-ratelimit-limit']),
        remaining: Number(headers['x-ratelimit-remaining']),
        resetAt: parseRateLimitTime(headers['x-ratelimit-reset'], this.now()),
      };
    }
    if (response.status >= 500) {
      throw new AirthingsError(ERROR_KINDS.SERVER, `${what}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return response;
  }

  async fetchToken() {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.send(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
      },
      'Token',
    );
    if ([400, 401, 403].includes(response.status)) {
      throw new AirthingsError(
        ERROR_KINDS.AUTH,
        `Client id or secret refused (HTTP ${response.status})`,
        { status: response.status },
      );
    }
    if (response.status !== 200) {
      throw new AirthingsError(ERROR_KINDS.PROTOCOL, `Token: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const data = parseJson(response.body, 'Token');
    if (typeof data?.access_token !== 'string' || !data.access_token) {
      throw new AirthingsError(ERROR_KINDS.PROTOCOL, 'Token: no access_token in the answer');
    }
    const lifetime = Number(data.expires_in);
    this.token = {
      value: data.access_token,
      type: typeof data.token_type === 'string' && data.token_type ? data.token_type : 'Bearer',
      // Without a lifetime, one hour: a refused token is renewed anyway.
      expiresAt: this.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000,
    };
    this.onSession(this.session);
  }

  async ensureToken() {
    if (!this.token || this.token.expiresAt - TOKEN_MARGIN_MS <= this.now()) {
      await this.fetchToken();
    }
  }

  /** GET on the API, the token renewed once when refused. */
  async get(path, what) {
    for (let attempt = 0; ; attempt += 1) {
      await this.ensureToken();
      const response = await this.send(
        `${API_URL}${path}`,
        { headers: { authorization: `${this.token.type} ${this.token.value}` } },
        what,
      );
      if (response.status === 401 && attempt === 0) {
        // Expired early, or revoked: one new token, then give up.
        this.token = null;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new AirthingsError(
          ERROR_KINDS.AUTH,
          `${what}: access refused (HTTP ${response.status})`,
          {
            status: response.status,
          },
        );
      }
      if (response.status !== 200) {
        throw new AirthingsError(ERROR_KINDS.PROTOCOL, `${what}: HTTP ${response.status}`, {
          status: response.status,
        });
      }
      return parseJson(response.body, what);
    }
  }

  async ensureAccount() {
    if (this.accountId) {
      return this.accountId;
    }
    const data = await this.get('/accounts', 'Accounts');
    // "It is safe to assume that the accountId remains constant for Consumer users."
    const id = Array.isArray(data?.accounts) ? data.accounts.find((a) => a?.id)?.id : undefined;
    if (typeof id !== 'string' || !id) {
      throw new AirthingsError(ERROR_KINDS.NO_ACCOUNT, 'No Airthings account for this API client');
    }
    this.accountId = id;
    this.onSession(this.session);
    return id;
  }

  /** The devices of the account, as the API gives them. */
  async getDevices() {
    const account = await this.ensureAccount();
    const data = await this.get(`/accounts/${encodeURIComponent(account)}/devices`, 'Devices');
    if (!Array.isArray(data?.devices)) {
      throw new AirthingsError(ERROR_KINDS.PROTOCOL, 'Devices: no device list in the answer');
    }
    return data.devices;
  }

  /** The latest values of every device, all pages, in metric units. */
  async getSensors() {
    const account = await this.ensureAccount();
    const results = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = page === 1 ? 'unit=metric' : `unit=metric&pageNumber=${page}`;
      const data = await this.get(
        `/accounts/${encodeURIComponent(account)}/sensors?${query}`,
        'Sensors',
      );
      if (!Array.isArray(data?.results)) {
        throw new AirthingsError(ERROR_KINDS.PROTOCOL, 'Sensors: no result list in the answer');
      }
      results.push(...data.results);
      const total = Number(data.totalPages);
      if (data.hasNext !== true || (Number.isFinite(total) && page >= total)) {
        break;
      }
    }
    return results;
  }
}

function validToken(token) {
  return (
    token &&
    typeof token === 'object' &&
    typeof token.value === 'string' &&
    token.value !== '' &&
    typeof token.type === 'string' &&
    Number.isFinite(token.expiresAt)
  );
}
