// -----------------------------------------------------------------------------
// From the Airthings Consumer API answers to plain records.
//
// Sensor types and units: the examples of the API (michaelahern/
// airthings-consumer-api README, ISC) and real answers posted in Home
// Assistant issue #140845: `radonShortTermAvg` in `bq`, `temp` in `c`,
// `humidity` in `pct`, `pressure` in `mbar`, `co2` in `ppm`, `voc` in `ppb`,
// `pm1`/`pm25` in `mgpc` (µg/m³ despite the name: the Airthings apps show µg/m³
// and Home Assistant declares µg/m³ for the same values), `lux`, `sla` (sound
// level, dBA). The integration asks for metric units; the imperial ones are
// converted anyway, in case an account setting wins over the query.
//
// `radonLongTermAvg` is not in the published examples: it is read if the API
// ever sends it. Types the integration has no Gladys couple for (mold,
// virusRisk, light in %, rssi…) are ignored.
// -----------------------------------------------------------------------------

const round = (decimals) => (value) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const same = (value) => value;

// API sensor type → feature key (permanent once published), accepted units
// (lower case, `undefined` when the API gives none) with their conversion to
// the unit of the feature, and the rounding.
export const SENSOR_TYPES = Object.freeze({
  radonShortTermAvg: {
    key: 'radon_short_term',
    units: { bq: same, 'bq/m3': same, pci: (v) => v * 37, 'pci/l': (v) => v * 37 },
    round: round(0),
  },
  radonLongTermAvg: {
    key: 'radon_long_term',
    units: { bq: same, 'bq/m3': same, pci: (v) => v * 37, 'pci/l': (v) => v * 37 },
    round: round(0),
  },
  co2: { key: 'co2', units: { ppm: same }, round: round(0) },
  voc: { key: 'voc', units: { ppb: same }, round: round(0) },
  pm1: { key: 'pm1', units: { mgpc: same, ugm3: same }, round: round(1) },
  pm25: { key: 'pm25', units: { mgpc: same, ugm3: same }, round: round(1) },
  pm10: { key: 'pm10', units: { mgpc: same, ugm3: same }, round: round(1) },
  temp: { key: 'temperature', units: { c: same, f: (v) => ((v - 32) * 5) / 9 }, round: round(1) },
  humidity: { key: 'humidity', units: { pct: same }, round: round(1) },
  pressure: {
    key: 'pressure',
    units: {
      mbar: same,
      hpa: same,
      pa: (v) => v / 100,
      kpa: (v) => v * 10,
      inhg: (v) => v * 33.8639,
    },
    round: round(1),
  },
  lux: { key: 'light', units: { lux: same }, round: round(0) },
  sla: { key: 'noise', units: { dba: same, db: same }, round: round(0) },
});

/** Feature keys of the measured values, in display order. */
export const VALUE_KEYS = Object.freeze([
  'radon_short_term',
  'radon_long_term',
  'co2',
  'voc',
  'pm1',
  'pm25',
  'pm10',
  'temperature',
  'humidity',
  'pressure',
  'light',
  'noise',
]);

const KEY_OF_TYPE = new Map(Object.entries(SENSOR_TYPES).map(([type, s]) => [type, s.key]));

// Product names by device type, as the Airthings apps write them. An unknown
// type is shown as the API writes it ("NEW_MODEL" → "New Model").
const PRODUCTS = {
  WAVE: 'Wave',
  WAVE_GEN2: 'Wave',
  WAVE_MINI: 'Wave Mini',
  WAVE_PLUS: 'Wave Plus',
  WAVE_RADON: 'Wave Radon',
  WAVE_ENHANCE: 'Wave Enhance',
  VIEW_PLUS: 'View Plus',
  VIEW_PLUS_BUSINESS: 'View Plus',
  VIEW_POLLUTION: 'View Pollution',
  VIEW_RADON: 'View Radon',
  VIEW_CO2: 'View CO2',
  SPACE_PLUS: 'Space Plus',
  SPACE_CO2_MINI: 'Space CO2 Mini',
  CORENTIUM_HOME_2: 'Corentium Home 2',
  HOME: 'Corentium Home',
  AP_1: 'Renew',
  HUB: 'Hub',
};

export function productName(type) {
  if (typeof type !== 'string' || !type) {
    return 'Airthings';
  }
  return (
    PRODUCTS[type] ??
    type
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(' ')
  );
}

const cleanText = (value, max) =>
  typeof value === 'string'
    ? value
        .replace(/[\p{Cc}]/gu, ' ')
        .trim()
        .slice(0, max)
    : '';

/**
 * One device of GET /devices.
 * @returns {{ serial: string, name: string, type: string, product: string, home: string, sensorKeys: string[] }|null}
 */
export function parseDevice(raw) {
  const serial = cleanText(raw?.serialNumber, 40);
  if (!serial) {
    return null;
  }
  const type = cleanText(raw.type, 40);
  const sensors = Array.isArray(raw.sensors) ? raw.sensors : [];
  const sensorKeys = VALUE_KEYS.filter((key) =>
    sensors.some((sensorType) => KEY_OF_TYPE.get(sensorType) === key),
  );
  return {
    serial,
    name: cleanText(raw.name, 60),
    type,
    product: productName(type),
    home: cleanText(raw.home, 60),
    sensorKeys,
  };
}

/**
 * The `recorded` date of a reading. The examples carry no time zone
 * ("2025-01-01T12:34:56"): read as UTC, the zone of the API timestamps.
 * @returns {number|null} epoch milliseconds
 */
export function parseRecorded(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const text = raw.trim();
  const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
  const at = Date.parse(zoned);
  return Number.isNaN(at) ? null : at;
}

/**
 * One result of GET /sensors.
 * @returns {{ serial: string, values: Record<string, number>, recordedAt: number|null, battery: number|null, ignored: string[], badUnits: string[] }|null}
 */
export function parseSensorResult(raw) {
  const serial = cleanText(raw?.serialNumber, 40);
  if (!serial) {
    return null;
  }
  const values = {};
  const ignored = [];
  const badUnits = [];
  for (const sensor of Array.isArray(raw.sensors) ? raw.sensors : []) {
    const type = sensor?.sensorType;
    const spec = Object.hasOwn(SENSOR_TYPES, type) ? SENSOR_TYPES[type] : null;
    if (!spec) {
      if (typeof type === 'string') {
        ignored.push(type);
      }
      continue;
    }
    const value = sensor.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const unit =
      typeof sensor.unit === 'string' ? sensor.unit.trim().toLowerCase().replace('³', '3') : '';
    // No unit: the metric one asked for.
    const convert = unit ? spec.units[unit] : same;
    if (!convert) {
      badUnits.push(`${type} in ${sensor.unit}`);
      continue;
    }
    values[spec.key] = spec.round(convert(value));
  }
  const battery = raw.batteryPercentage;
  return {
    serial,
    values,
    recordedAt: parseRecorded(raw.recorded),
    battery:
      typeof battery === 'number' && Number.isFinite(battery)
        ? Math.min(100, Math.max(0, Math.round(battery)))
        : null,
    ignored,
    badUnits,
  };
}
