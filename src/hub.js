// -----------------------------------------------------------------------------
// The Airthings hub: one record per sensor of the account, read from the
// cloud on the container's own timer, published to Gladys when it changes.
//
// One reading cycle = one request (GET /sensors gives every device of the
// account, 50 a page), plus the device list once an hour and a token every
// few hours. At the default five minutes that is about 13 requests an hour,
// far from the 120 of the API: the quota stays free for the "Test the
// connection" button, a second tool of the user, or a shorter interval.
//
// The core cannot be trusted to poll (GladysAssistant/Gladys#3198: a device
// created without should_poll is never polled, even on 5.2.1), so the timer
// is the source of the readings. The core's onPoll is a fallback that reads
// only when the timer has not done it for 90 % of a period: the one-minute
// poll_frequency of the devices never turns into one request a minute.
// A device the user adds gets its states from the last reading, without
// any request.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  API_QUOTA_PER_HOUR,
  AirthingsClient,
  AirthingsError,
  ERROR_KINDS,
} from './airthings/client.js';
import { httpRequest } from './airthings/http.js';
import { parseDevice, parseSensorResult } from './airthings/model.js';
import { hasCredentials } from './config.js';
import {
  AGE_KEY,
  BATTERY_KEY,
  buildDevice,
  deviceIds,
  featureKeysOf,
  sensorName,
} from './devices.js';
import { createIssueLog } from './issues.js';
import { CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, allLanguages, pick } from './texts.js';

const logger = createLogger({ name: 'airthings-hub' });

export const WIDGET_KEY = 'air_quality';

export const HUB_TIMINGS = {
  // The device list (names, sensors) changes when the user adds, removes or
  // renames a sensor in the Airthings app.
  devicesMs: 60 * 60_000,
  // A serial number missing from the list asks for the list again, at most this often.
  unknownSerialMs: 10 * 60_000,
  // An unchanged value is published again this often: the Gladys front shows
  // "no recent value" past 48 hours (well within the 12 hours of the rule).
  heartbeatMs: 6 * 60 * 60_000,
  // A reading older than this is not published again (its values would look
  // fresh), and the device is marked unreachable.
  staleMs: 3 * 60 * 60_000,
  // After a first network failure, try again this soon (a blip, not an outage).
  retryMs: 2 * 60_000,
  // After refused credentials, try again this rarely (the user must act).
  authRetryMs: 30 * 60_000,
};

const fingerprint = (config) =>
  createHash('sha256')
    .update(`${config.clientId}\n${config.clientSecret}`)
    .digest('hex')
    .slice(0, 16);

export class AirthingsHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/airthings/http.js)
   * @param {boolean} [options.timers] the reading timer (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request ?? httpRequest;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.credentials = null;
    /** @type {Map<string, object>} sensor records, by serial number */
    this.records = new Map();
    this.saved = { sensors: {} };
    this.devicesAt = 0;
    this.lastCycleAt = null;
    this.cycling = null;
    this.timer = null;
    this.stopped = false;
    /** The current failure of the cloud ({ kind, message, retryAt }), null when it answers. */
    this.error = null;
    this.failures = 0;
    this.connected = false;
    this.publishedDevices = null;
    this.transports = new Map();
    this.connection = null;
    this.issues = createIssueLog(logger);
    this.ignoredTypes = new Set();
    /** Serial numbers of the list without a sensor the integration reads (the hub). */
    this.skipped = new Set();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      credentials: typeof saved.credentials === 'string' ? saved.credentials : null,
      token: saved.token ?? null,
      accountId: saved.accountId ?? null,
      sensors: saved.sensors && typeof saved.sensors === 'object' ? saved.sensors : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again, from the last reading. */
  async resync(config) {
    this.publishedDevices = null;
    this.transports.clear();
    this.connection = null;
    this.gladys.forgetPublishedStates?.();
    const credentialsChanged = hasCredentials(config) && fingerprint(config) !== this.credentials;
    await this.reconfigure(config);
    if (!credentialsChanged) {
      // Same account: the last reading is sent again, without a request.
      await this.publishAllStates();
      await this.publishTransports();
      await this.publishConnectionStatus();
    }
  }

  async reconfigure(config) {
    this.config = config;
    if (!hasCredentials(config)) {
      this.dropClient();
      clearTimeout(this.timer);
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    const credentials = fingerprint(config);
    if (credentials !== this.credentials) {
      this.useCredentials(credentials);
      await this.refresh({ force: true, devices: true });
    } else {
      // Language or interval: the features keep their names (frozen at
      // creation), the discovery list shows the new ones.
      await this.publishDevices();
    }
    this.schedule();
  }

  /** New credentials: new client, the saved session reused only if it is theirs. */
  useCredentials(credentials) {
    this.dropClient();
    this.credentials = credentials;
    const own = this.saved.credentials === credentials;
    if (!own) {
      this.saved = { credentials, token: null, accountId: null, sensors: this.saved.sensors };
    }
    this.client = new AirthingsClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      request: this.request,
      now: this.now,
      session: own ? { token: this.saved.token, accountId: this.saved.accountId } : {},
      onSession: (session) => {
        this.saved.token = session.token;
        this.saved.accountId = session.accountId;
        this.store.save(this.saved);
      },
    });
  }

  dropClient() {
    this.client = null;
    this.credentials = null;
    this.records.clear();
    this.devicesAt = 0;
    this.lastCycleAt = null;
    this.error = null;
    this.failures = 0;
    this.connected = false;
    this.issues.clear();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    await this.cycling?.catch(() => {});
    await this.store.flush();
  }

  // --- Timer -----------------------------------------------------------------

  periodMs() {
    return this.config?.refreshMs ?? 5 * 60_000;
  }

  /** The delay before the next reading: the period, adjusted after a failure. */
  nextDelay() {
    const period = this.periodMs();
    if (!this.error) {
      return period;
    }
    const { kind, retryAt } = this.error;
    if (kind === ERROR_KINDS.RATE_LIMIT && retryAt) {
      return Math.max(period, retryAt - this.now());
    }
    if (kind === ERROR_KINDS.AUTH || kind === ERROR_KINDS.NO_ACCOUNT) {
      return Math.max(period, this.timings.authRetryMs);
    }
    // Network or server: a quick second try, then the normal pace.
    return this.failures === 1 ? Math.min(period, this.timings.retryMs) : period;
  }

  schedule(delay = this.nextDelay()) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        // Read by onPoll or "Test the connection" less than half a period ago: skip.
        const since = this.lastCycleAt === null ? Infinity : this.now() - this.lastCycleAt;
        if (since >= this.periodMs() / 2 || this.error) {
          await this.refresh();
        } else {
          logger.debug(`Read ${since} ms ago, timer reading skipped`);
        }
        this.issues.ok('timer');
      } catch (err) {
        this.issues.fail('timer', `Reading cycle failed: ${err.message}`, 'error');
      }
      this.schedule();
    }, delay);
    this.timer.unref?.();
  }

  /** The core's onPoll (fallback): read only if the timer has not done it lately. */
  async pollDevice(device) {
    if (!this.client || !this.recordOf(device.external_id)) {
      return;
    }
    const since = this.lastCycleAt === null ? Infinity : this.now() - this.lastCycleAt;
    if (since < this.periodMs() * 0.9) {
      logger.debug(`onPoll: read ${since} ms ago, nothing to do`);
      return;
    }
    await this.refresh();
  }

  // --- Reading the cloud -------------------------------------------------------

  /**
   * One reading of the account. Concurrent calls share it; `force` waits for
   * a reading in progress, then reads again.
   */
  async refresh({ force = false, devices = false } = {}) {
    while (this.cycling) {
      const running = this.cycling;
      await running.catch(() => {});
      if (!force) {
        return;
      }
    }
    this.cycling = this.cycle({ devices }).finally(() => {
      this.cycling = null;
    });
    return this.cycling;
  }

  async cycle({ devices }) {
    const client = this.client;
    if (!client) {
      return;
    }
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: reading skipped');
      return;
    }
    this.lastCycleAt = this.now();
    let changed = false;
    // The credentials may change during a request: nothing of the old
    // account is applied to the new one.
    const replaced = () => client !== this.client;
    try {
      if (devices || this.now() - this.devicesAt >= this.timings.devicesMs) {
        const list = await client.getDevices();
        if (replaced()) {
          return;
        }
        changed = this.applyDevices(list) || changed;
      }
      const results = await client.getSensors();
      if (replaced()) {
        return;
      }
      const unknown = results.some(
        (result) =>
          typeof result?.serialNumber === 'string' &&
          !this.records.has(result.serialNumber) &&
          !this.skipped.has(result.serialNumber),
      );
      if (
        unknown &&
        this.now() - this.devicesAt >= this.timings.unknownSerialMs &&
        client.canSend(1)
      ) {
        // A sensor registered since the last list.
        const fresh = await client.getDevices();
        if (replaced()) {
          return;
        }
        changed = this.applyDevices(fresh) || changed;
      }
      changed = this.applyReadings(results) || changed;
      changed = this.applySuccess() || changed;
    } catch (err) {
      if (!(err instanceof AirthingsError)) {
        throw err;
      }
      if (replaced()) {
        return;
      }
      changed = this.applyFailure(err);
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The device list of the API. Returns whether anything visible changed. */
  applyDevices(list) {
    this.devicesAt = this.now();
    const seen = new Set();
    this.skipped = new Set();
    let changed = false;
    const first = this.records.size === 0 && !this.connected;
    for (const raw of list) {
      const device = parseDevice(raw);
      // The hub, and any device without a sensor the integration reads.
      if (!device || seen.has(device.serial)) {
        continue;
      }
      if (device.sensorKeys.length === 0) {
        this.skipped.add(device.serial);
        continue;
      }
      seen.add(device.serial);
      const record = this.records.get(device.serial);
      if (record) {
        if (record.name !== device.name || record.product !== device.product) {
          changed = true;
        }
        Object.assign(record, device);
        continue;
      }
      this.records.set(device.serial, this.newRecord(device));
      changed = true;
      if (!first) {
        logger.info(`New Airthings sensor: ${sensorName(this.records.get(device.serial))}`);
      }
    }
    for (const [serial, record] of this.records) {
      if (!seen.has(serial)) {
        logger.info(`Airthings sensor no longer in the account: ${sensorName(record)}`);
        this.records.delete(serial);
        changed = true;
      }
    }
    return changed;
  }

  newRecord(device) {
    const saved = this.saved.sensors[device.serial];
    const savedKeys = Array.isArray(saved?.keys) ? saved.keys : [];
    return {
      ...device,
      // Before any reading: the sensors the API announces; then the ones it fills.
      valueKeys: new Set(savedKeys.length ? savedKeys : device.sensorKeys),
      read: savedKeys.length > 0,
      hasBattery: saved?.battery === true,
      reading: null,
    };
  }

  /** The latest values. Returns whether the widget shows something new. */
  applyReadings(results) {
    let changed = false;
    let save = false;
    for (const raw of results) {
      const reading = parseSensorResult(raw);
      const record = reading && this.records.get(reading.serial);
      if (!record) {
        continue;
      }
      for (const type of reading.ignored) {
        if (!this.ignoredTypes.has(type)) {
          this.ignoredTypes.add(type);
          logger.debug(`Sensor type "${type}" has no Gladys feature: ignored`);
        }
      }
      for (const problem of reading.badUnits) {
        this.issues.fail(
          `unit:${problem}`,
          `${sensorName(record)}: unexpected unit (${problem}), value ignored`,
        );
      }
      const keys = Object.keys(reading.values);
      if (!record.read && keys.length > 0) {
        // The first reading says which sensors really report (a Wave
        // Enhance announces light and noise it does not send).
        record.valueKeys = new Set(keys);
        record.read = true;
        save = true;
      }
      for (const key of keys) {
        if (!record.valueKeys.has(key)) {
          record.valueKeys.add(key);
          save = true;
        }
      }
      if (reading.battery !== null && !record.hasBattery) {
        record.hasBattery = true;
        save = true;
      }
      const previous = record.reading;
      if (
        !previous ||
        previous.recordedAt !== reading.recordedAt ||
        JSON.stringify(previous.values) !== JSON.stringify(reading.values) ||
        previous.battery !== reading.battery
      ) {
        changed = true;
      }
      record.reading = {
        values: reading.values,
        recordedAt: reading.recordedAt,
        battery: reading.battery,
      };
    }
    if (save) {
      for (const record of this.records.values()) {
        if (record.read) {
          this.saved.sensors[record.serial] = {
            keys: [...record.valueKeys],
            battery: record.hasBattery,
          };
        }
      }
      this.store.save(this.saved);
    }
    return changed;
  }

  applySuccess() {
    const wasError = this.error;
    this.error = null;
    this.failures = 0;
    if (!this.connected) {
      this.connected = true;
      const names = [...this.records.values()].map(sensorName).join(', ');
      logger.info(
        wasError
          ? `Airthings cloud reachable again: ${this.records.size} sensor(s)`
          : `Connected to the Airthings cloud: ${this.records.size} sensor(s)${names ? ` (${names})` : ''}`,
      );
    }
    this.issues.ok('cloud');
    return wasError !== null;
  }

  applyFailure(err) {
    const changed = this.error?.kind !== err.kind;
    this.error = { kind: err.kind, message: err.message, retryAt: err.retryAt ?? null };
    this.failures += 1;
    if (this.connected) {
      this.connected = false;
    }
    // Once when it starts (or changes), then at debug; one line when it ends.
    const level = err.kind === ERROR_KINDS.AUTH ? 'error' : 'warn';
    this.issues.fail('cloud', `Airthings cloud: ${err.message}`, level, err.kind);
    return changed;
  }

  // --- Publishing to Gladys ----------------------------------------------------

  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  recordOf(deviceExternalId) {
    for (const record of this.records.values()) {
      if (deviceIds(this.gladys, record.serial).device === deviceExternalId) {
        return record;
      }
    }
    return null;
  }

  /** The devices of the Discovery tab, published when they change. */
  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record, this.config?.language),
    );
    const signature = JSON.stringify(devices);
    if (signature === this.publishedDevices) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale sensor.
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedDevices = signature;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** Whether the reading of a record is recent enough to be published. */
  isFresh(record) {
    const at = record.reading?.recordedAt;
    // No date: trust the reading, it came with this answer.
    return Boolean(record.reading) && (at === null || this.now() - at < this.timings.staleMs);
  }

  /** The states of one sensor, from its last reading (no request). */
  statesOf(record) {
    if (!record.reading) {
      return [];
    }
    const ids = deviceIds(this.gladys, record.serial);
    const states = [];
    const { values, battery, recordedAt } = record.reading;
    if (this.isFresh(record)) {
      for (const key of featureKeysOf(record)) {
        const value = key === BATTERY_KEY ? battery : values[key];
        if (typeof value === 'number') {
          states.push({ device_feature_external_id: ids.feature(key), state: value });
        }
      }
    }
    if (recordedAt !== null) {
      // A clock a little ahead of the API's: never a negative age.
      const minutes = Math.max(0, Math.round((this.now() - recordedAt) / 60_000));
      states.push({ device_feature_external_id: ids.feature(AGE_KEY), state: minutes });
    }
    return states;
  }

  async publishStates(records) {
    const states = records.flatMap((record) => this.statesOf(record));
    if (states.length === 0) {
      return;
    }
    try {
      // Only the changes, and every value again after `heartbeatMs`.
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'States accepted again by Gladys');
    } catch (err) {
      this.issues.fail('states', `States refused by Gladys: ${err.message}`);
    }
  }

  /** The states of the sensors the user added to Gladys (the others would be dropped). */
  async publishAllStates() {
    const created = this.createdIds();
    await this.publishStates(
      [...this.records.values()].filter((record) =>
        created.has(deviceIds(this.gladys, record.serial).device),
      ),
    );
  }

  /** The user added (or updated) a device: its states, from the last reading. */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    await this.publishStates([record]);
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  transportOf(record) {
    const down =
      this.error &&
      this.error.kind !== ERROR_KINDS.RATE_LIMIT &&
      this.error.kind !== ERROR_KINDS.PROTOCOL;
    return !down && this.isFresh(record) ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
  }

  async publishTransports() {
    const created = this.createdIds();
    const entries = [];
    for (const record of this.records.values()) {
      const externalId = deviceIds(this.gladys, record.serial).device;
      if (!created.has(externalId) || (!record.reading && !this.error)) {
        continue;
      }
      const transport = this.transportOf(record);
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports');
    } catch (err) {
      this.issues.fail('transports', `Transports refused by Gladys: ${err.message}`);
    }
  }

  /** The status under the integration name, in the Configuration screen. */
  connectionStatus() {
    if (!this.config || !hasCredentials(this.config)) {
      return { connected: false, message: CONNECTION_TEXT.noCredentials };
    }
    if (this.error) {
      // Rate limited: still connected, the readings only wait.
      return {
        connected: this.error.kind === ERROR_KINDS.RATE_LIMIT,
        message: ERROR_TEXT[this.error.kind],
      };
    }
    if (!this.connected) {
      return { connected: false };
    }
    return this.records.size === 0
      ? { connected: true, message: CONNECTION_TEXT.noSensor }
      : { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    if (!this.connected && !this.error && hasCredentials(this.config ?? {})) {
      return; // first reading not done yet
    }
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection-status');
    } catch (err) {
      this.issues.fail('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Reports ---------------------------------------------------------------------

  /** "Test the connection": read the account now (device list included), report. */
  async testConnection() {
    if (!this.client) {
      return CONNECTION_TEXT.noCredentials;
    }
    logger.info('Connection test requested');
    await this.refresh({ force: true, devices: true });
    const used = this.client?.requestsLastHour() ?? 0;
    const limit = this.client?.rateLimit;
    return allLanguages((language) => {
      const text = REPORT_TEXT[language];
      if (this.error) {
        return text.failed(pick(ERROR_TEXT[this.error.kind], language));
      }
      let names = [...this.records.values()].map(sensorName).join(', ');
      if (names.length > 100) {
        names = `${names.slice(0, 99).trimEnd()}…`;
      }
      const quota =
        limit && Number.isFinite(limit.limit) && Number.isFinite(limit.remaining)
          ? text.quota(limit.limit - limit.remaining, limit.limit)
          : text.quota(used, API_QUOTA_PER_HOUR);
      return `${text.ok(this.records.size, names)} ${quota}`;
    });
  }

  /** The sensors a widget shows: one device, or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const record = this.recordOf(deviceExternalId);
    return record ? [record] : [];
  }
}
