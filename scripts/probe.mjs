#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Airthings cloud, read-only, from a machine with Internet
// access (the development sessions of this repository cannot reach it).
//
//   node scripts/probe.mjs
//       Fake credentials: runs the real token request and expects a refusal.
//       Prints the HTTP status and the shape of the answer, nothing else.
//
//   AIRTHINGS_CLIENT_ID=… AIRTHINGS_CLIENT_SECRET=… node scripts/probe.mjs
//       A real API client: token, account, devices, sensors, through the
//       integration's own client (src/airthings/client.js). Prints counts,
//       device types, sensor types, units, the format of the `recorded` date,
//       the computed measurement age and the rate-limit headers. Never the
//       credentials, the token, the account id, a serial number or a name.
//
// It sends 3 to 5 requests of the hourly quota (120), and changes nothing.
// -----------------------------------------------------------------------------

import { AirthingsClient, TOKEN_URL } from '../src/airthings/client.js';
import { httpRequest } from '../src/airthings/http.js';
import { parseRecorded, parseSensorResult } from '../src/airthings/model.js';

const clientId = process.env.AIRTHINGS_CLIENT_ID || 'probe-fake-client-id';
const clientSecret = process.env.AIRTHINGS_CLIENT_SECRET || 'probe-fake-client-secret';
const real = Boolean(process.env.AIRTHINGS_CLIENT_ID && process.env.AIRTHINGS_CLIENT_SECRET);

/** The shape of a JSON value: keys and types, no content. */
function shape(value, depth = 0) {
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${shape(value[0], depth + 1)} ×${value.length}]`;
  }
  if (value && typeof value === 'object') {
    if (depth > 3) {
      return '{…}';
    }
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${key}: ${shape(item, depth + 1)}`)
      .join(', ')} }`;
  }
  return typeof value;
}

/** Wraps the HTTP seam to print each request (path and status only). */
const loggedRequest = async (url, options) => {
  const target = new URL(url);
  // The account id is in the path: masked.
  const path = target.pathname.replace(/accounts\/[^/]+/, 'accounts/<account>');
  try {
    const response = await httpRequest(url, options);
    const limit = response.headers['x-ratelimit-limit'];
    const rate = limit
      ? ` (rate limit ${response.headers['x-ratelimit-remaining']}/${limit}, reset ${response.headers['x-ratelimit-reset']})`
      : '';
    console.log(
      `${options?.method ?? 'GET'} ${target.host}${path}${target.search} → ${response.status}${rate}`,
    );
    return response;
  } catch (err) {
    console.log(`${options?.method ?? 'GET'} ${target.host}${path} → ${err.name}: ${err.message}`);
    throw err;
  }
};

async function probeFake() {
  console.log(`Token request with fake credentials (${TOKEN_URL}):`);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await loggedRequest(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    body = null;
  }
  console.log(
    `  answer shape: ${body === null ? `not JSON (${response.body.length} bytes)` : shape(body)}`,
  );
  if (body && typeof body.error === 'string') {
    console.log(`  error code: ${body.error}`);
  }
  // The same request with the credentials in the body, the other common
  // client-credentials form: tells which one the API expects if the first
  // ever stops working.
  const alternative = await loggedRequest(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: ['read:device:current_values'],
    }),
  });
  console.log(`  (credentials in the JSON body: HTTP ${alternative.status})`);
  const refused = [400, 401, 403].includes(response.status);
  console.log(
    refused
      ? 'OK: the fake credentials are refused, as the integration expects (AUTH error).'
      : `UNEXPECTED: HTTP ${response.status} for fake credentials.`,
  );
  return refused;
}

async function probeReal() {
  const client = new AirthingsClient({ clientId, clientSecret, request: loggedRequest });
  const devices = await client.getDevices();
  console.log(`Devices: ${devices.length}`);
  const types = new Map();
  for (const device of devices) {
    types.set(device.type, [
      ...new Set([...(types.get(device.type) ?? []), ...(device.sensors ?? [])]),
    ]);
  }
  for (const [type, sensors] of types) {
    console.log(`  ${type}: ${sensors.join(', ') || '(no sensor)'}`);
  }
  const results = await client.getSensors();
  console.log(`Sensor results: ${results.length}`);
  const units = new Map();
  const recorded = new Set();
  for (const result of results) {
    for (const sensor of result.sensors ?? []) {
      units.set(`${sensor.sensorType} in ${sensor.unit}`, typeof sensor.value);
    }
    if (typeof result.recorded === 'string') {
      // The format only: digits replaced.
      recorded.add(result.recorded.replace(/\d/g, '9'));
    }
    const parsed = parseSensorResult(result);
    const at = parseRecorded(result.recorded);
    console.log(
      `  a result: ${Object.keys(parsed?.values ?? {}).length} values read, ` +
        `battery ${parsed?.battery === null ? 'none' : 'yes'}, ` +
        `age ${at === null ? 'unknown' : `${Math.round((Date.now() - at) / 60_000)} min`}, ` +
        `ignored [${parsed?.ignored.join(', ')}], bad units [${parsed?.badUnits.join(', ')}]`,
    );
  }
  console.log(`Sensor types and units: ${[...units.keys()].sort().join('; ')}`);
  console.log(`recorded formats: ${[...recorded].join(', ') || 'none'}`);
  console.log(`Result shape: ${shape(results[0] ?? null)}`);
  console.log(`Requests sent: ${client.requestsLastHour()}`);
  return true;
}

try {
  const ok = real ? await probeReal() : await probeFake();
  process.exit(ok ? 0 : 1);
} catch (err) {
  // The client's errors never carry credentials nor tokens.
  console.log(`FAILED: ${err.kind ?? err.name}: ${err.message}`);
  process.exit(1);
}
