// -----------------------------------------------------------------------------
// One Gladys device per Airthings sensor (the hub, which measures nothing, is
// left out).
//
// Identity: the serial number the API gives, never the name: renaming a
// sensor in the Airthings app keeps the Gladys device and its history.
//
// Features (category/type couples of the core table, test/gladys-rules.test.js):
//   - radon, short and long term averages: counter-sensor/integer in Bq/m³ —
//     Gladys has no radon category, and the unit carries the meaning; the
//     widget gives the colour code;
//   - CO2 co2-sensor/decimal, VOC voc-sensor/decimal, PM2.5 pm25-sensor/decimal,
//     PM10 pm10-sensor/decimal, PM1 pm25-sensor/decimal too (Gladys has no PM1
//     category; the PM2.5 colours of the front fit PM1, a part of it);
//   - temperature, humidity, pressure (hPa), light (lux), noise (dBA);
//   - battery (battery/integer, %) for the sensors that report one;
//   - measurement age (duration, minutes): how old the last
//     reading of the sensor is. A scene "measurement age above 180 min" warns
//     of a sensor that stopped uploading (hub unplugged, Bluetooth out of
//     range, flat batteries).
//
// The Gladys front names a row after the device, not the feature, when no
// other feature of the device shares its *type* (front/src/utils/device.js
// matches on the type only): "Salon 45 Bq/m³" would not say it is radon.
// Radon, battery and noise only exist as integers in Gladys, everything else
// is published as a decimal, and the measurement age takes the type that
// keeps every type shared (ageType). test/gladys-rules.test.js checks it on
// every fixture.
//
// The devices are published with should_poll: true and a one-minute
// poll_frequency, so a Gladys that polls calls onPoll as a fallback; the
// readings are driven by the container's own timer (src/hub.js), and onPoll
// never costs an API request within the period.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { VALUE_KEYS } from './airthings/model.js';

export const DEVICE_TYPE = 'airthings';
export const SERIAL_PARAM = 'AIRTHINGS_SERIAL';
export const MODEL_PARAM = 'AIRTHINGS_MODEL';

export const BATTERY_KEY = 'battery';
export const AGE_KEY = 'measurement_age';

// Display bounds (the core never applies them on write).
const sensor = (category, type, unit, min, max, extra = {}) => ({
  category,
  type,
  unit,
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

// Feature key (suffix of the external id, permanent once published) → definition.
export const FEATURES = Object.freeze({
  radon_short_term: sensor(
    CATEGORIES.COUNTER_SENSOR,
    TYPES.SENSOR.INTEGER,
    UNITS.BECQUEREL_PER_CUBIC_METER,
    0,
    1000,
  ),
  radon_long_term: sensor(
    CATEGORIES.COUNTER_SENSOR,
    TYPES.SENSOR.INTEGER,
    UNITS.BECQUEREL_PER_CUBIC_METER,
    0,
    1000,
  ),
  co2: sensor(CATEGORIES.CO2_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.PPM, 0, 5000),
  voc: sensor(CATEGORIES.VOC_SENSOR, TYPES.VOC_SENSOR.DECIMAL, UNITS.PPB, 0, 10000),
  pm1: sensor(
    CATEGORIES.PM25_SENSOR,
    TYPES.SENSOR.DECIMAL,
    UNITS.MICROGRAM_PER_CUBIC_METER,
    0,
    500,
  ),
  pm25: sensor(
    CATEGORIES.PM25_SENSOR,
    TYPES.SENSOR.DECIMAL,
    UNITS.MICROGRAM_PER_CUBIC_METER,
    0,
    500,
  ),
  pm10: sensor(
    CATEGORIES.PM10_SENSOR,
    TYPES.SENSOR.DECIMAL,
    UNITS.MICROGRAM_PER_CUBIC_METER,
    0,
    500,
  ),
  temperature: sensor(CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.CELSIUS, -20, 50),
  humidity: sensor(CATEGORIES.HUMIDITY_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.PERCENT, 0, 100),
  pressure: sensor(CATEGORIES.PRESSURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.HECTO_PASCAL, 700, 1100),
  light: sensor(CATEGORIES.LIGHT_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.LUX, 0, 10000),
  noise: sensor(CATEGORIES.NOISE_SENSOR, TYPES.SENSOR.INTEGER, UNITS.DECIBEL, 0, 130),
  [BATTERY_KEY]: sensor(CATEGORIES.BATTERY, TYPES.BATTERY.INTEGER, UNITS.PERCENT, 0, 100),
  // Changes at every reading: no history, it would only be a saw tooth. Its
  // type is chosen per device (ageType): duration/integer or duration/decimal.
  [AGE_KEY]: sensor(CATEGORIES.DURATION, TYPES.DURATION.DECIMAL, UNITS.MINUTES, 0, 1440, {
    keep_history: false,
  }),
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    radon_short_term: 'Radon (short term)',
    radon_long_term: 'Radon (long term)',
    co2: 'CO₂',
    voc: 'VOC',
    pm1: 'PM1',
    pm25: 'PM2.5',
    pm10: 'PM10',
    temperature: 'Temperature',
    humidity: 'Humidity',
    pressure: 'Pressure',
    light: 'Light',
    noise: 'Noise',
    battery: 'Battery',
    measurement_age: 'Measurement age',
  },
  fr: {
    radon_short_term: 'Radon (court terme)',
    radon_long_term: 'Radon (long terme)',
    co2: 'CO₂',
    voc: 'COV',
    pm1: 'PM1',
    pm25: 'PM2.5',
    pm10: 'PM10',
    temperature: 'Température',
    humidity: 'Humidité',
    pressure: 'Pression',
    light: 'Luminosité',
    noise: 'Bruit',
    battery: 'Batterie',
    measurement_age: 'Âge de la mesure',
  },
  de: {
    radon_short_term: 'Radon (kurzfristig)',
    radon_long_term: 'Radon (langfristig)',
    co2: 'CO₂',
    voc: 'VOC',
    pm1: 'PM1',
    pm25: 'PM2.5',
    pm10: 'PM10',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    pressure: 'Luftdruck',
    light: 'Helligkeit',
    noise: 'Lärmpegel',
    battery: 'Batterie',
    measurement_age: 'Alter der Messung',
  },
  es: {
    radon_short_term: 'Radón (corto plazo)',
    radon_long_term: 'Radón (largo plazo)',
    co2: 'CO₂',
    voc: 'COV',
    pm1: 'PM1',
    pm25: 'PM2.5',
    pm10: 'PM10',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    pressure: 'Presión',
    light: 'Luminosidad',
    noise: 'Ruido',
    battery: 'Batería',
    measurement_age: 'Antigüedad de la medición',
  },
};

/** External ids of a sensor's device and features. */
export const deviceIds = (gladys, serial) => gladys.externalIds(DEVICE_TYPE, serial);

/** The feature keys of a sensor, in display order. */
export function featureKeysOf(record) {
  const keys = VALUE_KEYS.filter((key) => record.valueKeys.has(key));
  if (record.hasBattery) {
    keys.push(BATTERY_KEY);
  }
  keys.push(AGE_KEY);
  return keys;
}

/**
 * The type of the measurement age on a device: the one that keeps a feature
 * from being alone of its type. Radon, battery and noise exist only as
 * integers in Gladys, the other values as decimals; the age, a whole number
 * of minutes, fits both.
 */
export function ageType(keys) {
  const integers = keys.filter(
    (key) => key !== AGE_KEY && FEATURES[key].type === TYPES.SENSOR.INTEGER,
  ).length;
  return integers === 1 ? TYPES.DURATION.INTEGER : TYPES.DURATION.DECIMAL;
}

/** The name shown for a sensor: its name in the Airthings app, else its model and serial. */
export const sensorName = (record) => record.name || `${record.product} ${record.serial}`;

/**
 * The discovery payload of a sensor.
 * @param {object} gladys SDK client
 * @param {object} record a sensor record of the hub
 * @param {string} language feature names language
 */
export function buildDevice(gladys, record, language = 'fr') {
  const ids = deviceIds(gladys, record.serial);
  const names = NAMES[language] ?? NAMES.fr;
  const keys = featureKeysOf(record);
  return {
    name: sensorName(record),
    external_id: ids.device,
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [
      { name: SERIAL_PARAM, value: record.serial },
      { name: MODEL_PARAM, value: record.product },
    ],
    features: keys.map((key) => ({
      ...FEATURES[key],
      ...(key === AGE_KEY ? { type: ageType(keys) } : {}),
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}
