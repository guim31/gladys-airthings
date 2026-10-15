// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `air_quality`.
//
// The use case: a glance at the wall tablet says whether a room needs airing,
// and above all whether its radon stays under the reference level — the
// health question behind an Airthings sensor in Brittany, the Massif Central
// or Corsica. Colours (src/levels.js): radon green under 100 Bq/m³ (WHO),
// red from the reference level of the configuration (300 Bq/m³ by default,
// France and the EU), orange in between.
//
// Two views, chosen in the widget settings:
//   - every sensor (default): one status row per room, its dot the colour of
//     the worst of its values, plus the highest radon and CO2 of the house;
//   - one sensor: a caption, five tiles (radon, CO2, PM2.5, temperature,
//     humidity first), the radon curve of the week when the device is added
//     to Gladys, and a status list (radon verdict, the other values, battery,
//     age of the measurement).
//
// Budget (8 components, 2 texts, 6 tiles, 1 status, 1 focal): at most a
// caption, a body text (cloud error), 5 tiles, 1 chart and 1 status. The
// values are sent inline, not bound to device features, so the widget works
// before the devices are added to Gladys; only the chart needs them.
// -----------------------------------------------------------------------------

import { WIDGET_CHART_INTERVALS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { BATTERY_KEY, NAMES, deviceIds, sensorName } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { LEVELS, WHO_RADON, levelOf, worst } from './levels.js';
import { CONNECTION_TEXT, ERROR_TEXT, pick } from './texts.js';

export const TEXT = {
  noSensor: CONNECTION_TEXT.noSensor,
  unknown: {
    en: 'This sensor is no longer in the Airthings account: choose another one in the widget settings.',
    fr: "Ce capteur n'est plus dans le compte Airthings : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser Sensor ist nicht mehr im Airthings-Konto: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este sensor ya no está en la cuenta de Airthings: elija otro en la configuración del widget.',
  },
  waiting: {
    en: 'Waiting for the first reading of the Airthings cloud…',
    fr: 'En attente de la première relève du cloud Airthings…',
    de: 'Warte auf die erste Abfrage der Airthings-Cloud…',
    es: 'Esperando la primera lectura de la nube de Airthings…',
  },
  radon: { en: 'Radon', fr: 'Radon', de: 'Radon', es: 'Radón' },
  radonMax: { en: 'Highest radon', fr: 'Radon max', de: 'Höchster Radonwert', es: 'Radón máximo' },
  co2Max: { en: 'Highest CO₂', fr: 'CO₂ max', de: 'Höchster CO₂-Wert', es: 'CO₂ máximo' },
  radonLevel: {
    en: 'Radon level',
    fr: 'Niveau de radon',
    de: 'Radonwert',
    es: 'Nivel de radón',
  },
  lastMeasurement: {
    en: 'Last measurement',
    fr: 'Dernière mesure',
    de: 'Letzte Messung',
    es: 'Última medición',
  },
  noRecent: {
    en: 'No recent measurement',
    fr: 'Pas de mesure récente',
    de: 'Keine aktuelle Messung',
    es: 'Sin medición reciente',
  },
};

// Texts with a number in them (≤ 40 characters once filled, ≤ 80 for the caption).
export const FORMAT_TEXT = {
  en: {
    good: () => `Good (under ${WHO_RADON} Bq/m³)`,
    fair: (reference) => `To watch (under ${reference} Bq/m³)`,
    poor: (reference) => `Above the reference (${reference} Bq/m³)`,
    reference: (reference) => `Radon reference level: ${reference} Bq/m³`,
    minutesAgo: (minutes) => `${minutes} min ago`,
    hoursAgo: (hours) => `${hours} h ago`,
    cloudError: (reason) => `Airthings cloud: ${reason}.`,
  },
  fr: {
    good: () => `Bon (moins de ${WHO_RADON} Bq/m³)`,
    fair: (reference) => `À surveiller (moins de ${reference} Bq/m³)`,
    poor: (reference) => `Au-dessus de la référence (${reference} Bq/m³)`,
    reference: (reference) => `Niveau de référence du radon : ${reference} Bq/m³`,
    minutesAgo: (minutes) => `il y a ${minutes} min`,
    hoursAgo: (hours) => `il y a ${hours} h`,
    cloudError: (reason) => `Cloud Airthings : ${reason}.`,
  },
  de: {
    good: () => `Gut (unter ${WHO_RADON} Bq/m³)`,
    fair: (reference) => `Beobachten (unter ${reference} Bq/m³)`,
    poor: (reference) => `Über dem Referenzwert (${reference} Bq/m³)`,
    reference: (reference) => `Radon-Referenzwert: ${reference} Bq/m³`,
    minutesAgo: (minutes) => `vor ${minutes} min`,
    hoursAgo: (hours) => `vor ${hours} h`,
    cloudError: (reason) => `Airthings-Cloud: ${reason}.`,
  },
  es: {
    good: () => `Bueno (menos de ${WHO_RADON} Bq/m³)`,
    fair: (reference) => `A vigilar (menos de ${reference} Bq/m³)`,
    poor: (reference) => `Sobre la referencia (${reference} Bq/m³)`,
    reference: (reference) => `Nivel de referencia del radón: ${reference} Bq/m³`,
    minutesAgo: (minutes) => `hace ${minutes} min`,
    hoursAgo: (hours) => `hace ${hours} h`,
    cloudError: (reason) => `Nube de Airthings: ${reason}.`,
  },
};

const UNITS = {
  radon_short_term: 'Bq/m³',
  radon_long_term: 'Bq/m³',
  co2: 'ppm',
  voc: 'ppb',
  pm1: 'µg/m³',
  pm25: 'µg/m³',
  pm10: 'µg/m³',
  temperature: '°C',
  humidity: '%',
  pressure: 'hPa',
  light: 'lux',
  noise: 'dBA',
  [BATTERY_KEY]: '%',
};

const ICONS = {
  radon_short_term: 'activity',
  radon_long_term: 'activity',
  co2: 'wind',
  voc: 'cloud',
  pm1: 'cloud-drizzle',
  pm25: 'cloud-drizzle',
  pm10: 'cloud-drizzle',
  temperature: 'thermometer',
  humidity: 'droplet',
  pressure: 'cloud',
  light: 'sun',
  noise: 'volume-2',
  [BATTERY_KEY]: 'battery',
};

// What a tile shows first, when the sensor measures it.
const TILE_ORDER = [
  'radon_short_term',
  'co2',
  'pm25',
  'temperature',
  'humidity',
  'voc',
  'pm1',
  'pm10',
  'radon_long_term',
  'pressure',
  'light',
  'noise',
];
const MAX_TILES = 5;
const MAX_ROWS = 10;

const LEVEL_COLORS = {
  [LEVELS.GOOD]: WIDGET_COLORS.SUCCESS,
  [LEVELS.FAIR]: WIDGET_COLORS.WARNING,
  [LEVELS.POOR]: WIDGET_COLORS.DANGER,
};
const colorOf = (level) => LEVEL_COLORS[level] ?? WIDGET_COLORS.NEUTRAL;

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const formatNumber = (value, language) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);

/** "45 Bq/m³", in the number format of the language. */
const withUnit = (key, value, language) => `${formatNumber(value, language)} ${UNITS[key]}`;

/** A tile label: the feature name, shortened for radon. */
const labelOf = (key, language) =>
  key === 'radon_short_term' ? pick(TEXT.radon, language) : (NAMES[language] ?? NAMES.en)[key];

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The values a widget can show for a sensor, or null without a fresh reading. */
function valuesOf(hub, record) {
  if (!hub.isFresh(record)) {
    return null;
  }
  return record.reading.values;
}

function ageText(hub, record, language) {
  const at = record.reading?.recordedAt;
  if (at === null || at === undefined) {
    return null;
  }
  const minutes = Math.max(0, Math.round((hub.now() - at) / 60_000));
  const text = FORMAT_TEXT[language] ?? FORMAT_TEXT.en;
  return minutes < 120 ? text.minutesAgo(minutes) : text.hoursAgo(Math.floor(minutes / 60));
}

function radonVerdict(value, reference, language) {
  const text = FORMAT_TEXT[language] ?? FORMAT_TEXT.en;
  const level = levelOf('radon_short_term', value, reference);
  return { level, text: text[level](reference) };
}

/** Body text of a cloud error, null when the cloud answers. */
function errorText(hub, language) {
  if (!hub.error) {
    return null;
  }
  const text = FORMAT_TEXT[language] ?? FORMAT_TEXT.en;
  return {
    type: 'text',
    variant: 'body',
    text: fit(text.cloudError(pick(ERROR_TEXT[hub.error.kind], language)), 300),
  };
}

/** Every sensor: one row per room. */
function houseView(hub, records, language, reference) {
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: (FORMAT_TEXT[language] ?? FORMAT_TEXT.en).reference(reference),
    },
  ];
  const error = errorText(hub, language);
  if (error) {
    components.push(error);
  }
  const fresh = records
    .map((record) => ({ record, values: valuesOf(hub, record) }))
    .filter(({ values }) => values);
  const highest = (key) =>
    fresh.reduce(
      (max, { values }) =>
        typeof values[key] === 'number' ? Math.max(max ?? -Infinity, values[key]) : max,
      null,
    );
  const radon = highest('radon_short_term');
  if (radon !== null) {
    components.push({
      type: 'value',
      value: radon,
      unit: UNITS.radon_short_term,
      label: pick(TEXT.radonMax, language),
      icon: ICONS.radon_short_term,
      color: colorOf(levelOf('radon_short_term', radon, reference)),
    });
  }
  const co2 = highest('co2');
  if (co2 !== null) {
    components.push({
      type: 'value',
      value: co2,
      unit: UNITS.co2,
      label: pick(TEXT.co2Max, language),
      icon: ICONS.co2,
      color: colorOf(levelOf('co2', co2, reference)),
    });
  }

  const rows = records.map((record) => {
    const values = valuesOf(hub, record);
    const label = fit(sensorName(record), 40);
    if (!values) {
      return {
        rank: -1,
        label,
        icon: 'wifi-off',
        value: pick(record.reading ? TEXT.noRecent : TEXT.waiting, language).slice(0, 40),
        color: WIDGET_COLORS.NEUTRAL,
      };
    }
    const keys = ['radon_short_term', 'co2', 'pm25', 'temperature', 'humidity'].filter(
      (key) => typeof values[key] === 'number',
    );
    const level = worst(
      Object.entries(values).map(([key, value]) => levelOf(key, value, reference)),
    );
    let text = '';
    for (const key of keys) {
      const next = text
        ? `${text} · ${withUnit(key, values[key], language)}`
        : withUnit(key, values[key], language);
      if (next.length > 40) {
        break;
      }
      text = next;
    }
    return {
      rank: [LEVELS.GOOD, LEVELS.FAIR, LEVELS.POOR].indexOf(level),
      label,
      icon: values.radon_short_term !== undefined ? ICONS.radon_short_term : ICONS.co2,
      value: text || '—',
      color: colorOf(level),
    };
  });
  // The rooms that need attention first.
  rows.sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label, language));
  components.push({
    type: 'status',
    items: rows.slice(0, MAX_ROWS).map(({ rank: _rank, ...item }) => item),
  });
  return { ttl_seconds: 300, components };
}

/** One sensor: tiles, its radon curve, the rest as status rows. */
function sensorView(hub, record, language, reference) {
  const caption = fit(
    record.home
      ? `${sensorName(record)} · ${record.product} · ${record.home}`
      : `${sensorName(record)} · ${record.product}`,
    80,
  );
  const components = [{ type: 'text', variant: 'caption', text: caption }];
  const error = errorText(hub, language);
  if (error) {
    components.push(error);
  }
  const values = valuesOf(hub, record) ?? {};
  const shown = TILE_ORDER.filter((key) => typeof values[key] === 'number').slice(0, MAX_TILES);
  for (const key of shown) {
    components.push({
      type: 'value',
      value: values[key],
      unit: UNITS[key],
      label: labelOf(key, language),
      icon: ICONS[key],
      color: colorOf(levelOf(key, values[key], reference)),
    });
  }

  // The week of radon (or CO2) from the history Gladys keeps: the device must be added.
  const ids = deviceIds(hub.gladys, record.serial);
  const created = hub.createdIds().has(ids.device);
  const curveKey = ['radon_short_term', 'co2'].find((key) => record.valueKeys.has(key));
  if (created && curveKey) {
    components.push({
      type: 'chart',
      device_features: [ids.feature(curveKey)],
      interval: WIDGET_CHART_INTERVALS.LAST_WEEK,
      chart_type: 'line',
      title: labelOf(curveKey, language),
    });
  }

  const items = [];
  if (typeof values.radon_short_term === 'number') {
    const verdict = radonVerdict(values.radon_short_term, reference, language);
    items.push({
      label: pick(TEXT.radonLevel, language),
      icon: 'alert-circle',
      value: verdict.text,
      color: colorOf(verdict.level),
    });
  }
  for (const key of TILE_ORDER) {
    if (shown.includes(key) || typeof values[key] !== 'number') {
      continue;
    }
    items.push({
      label: (NAMES[language] ?? NAMES.en)[key],
      icon: ICONS[key],
      value: withUnit(key, values[key], language),
      color: colorOf(levelOf(key, values[key], reference)),
    });
  }
  if (typeof record.reading?.battery === 'number') {
    items.push({
      label: (NAMES[language] ?? NAMES.en)[BATTERY_KEY],
      icon: ICONS[BATTERY_KEY],
      value: `${record.reading.battery} %`,
      color: record.reading.battery <= 10 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    });
  }
  const fresh = hub.isFresh(record);
  const age = ageText(hub, record, language);
  items.push({
    label: pick(TEXT.lastMeasurement, language),
    icon: 'clock',
    value: (age ?? pick(record.reading ? TEXT.noRecent : TEXT.waiting, language)).slice(0, 40),
    color: fresh ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.WARNING,
  });
  // The last row (the age) always stays.
  const rows = items.length > MAX_ROWS ? [...items.slice(0, MAX_ROWS - 1), items.at(-1)] : items;
  components.push({ type: 'status', items: rows });
  return { ttl_seconds: 300, components };
}

async function get(hub, { settings, language = 'en' } = {}) {
  const lang = FORMAT_TEXT[language] ? language : 'en';
  if (!hub.client) {
    return message(CONNECTION_TEXT.noCredentials, lang);
  }
  const reference = hub.config.radonReference;
  if (hub.records.size === 0) {
    if (hub.error) {
      return { ttl_seconds: 300, components: [errorText(hub, lang)] };
    }
    return message(hub.connected ? TEXT.noSensor : TEXT.waiting, lang);
  }
  if (settings?.device) {
    const [record] = hub.view(settings.device);
    if (!record) {
      return message(TEXT.unknown, lang);
    }
    return sensorView(hub, record, lang, reference);
  }
  return houseView(hub, hub.view(), lang, reference);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
