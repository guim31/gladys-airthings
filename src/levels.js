// -----------------------------------------------------------------------------
// Air quality levels, for the colours of the widget: good, fair, poor.
//
// Radon: below 100 Bq/m³ (the WHO recommendation) is good; from the reference
// level chosen in the configuration (300 Bq/m³ by default, the French and EU
// reference level of the Public Health Code and directive 2013/59/Euratom)
// it is poor; in between, fair. The other thresholds are those the Airthings
// apps use, so the widget and the device screen agree:
//   CO2 800 / 1000 ppm, VOC 250 / 2000 ppb, PM 10 / 25 µg/m³,
//   humidity good from 30 to 60 %, poor under 25 or from 70 %.
// -----------------------------------------------------------------------------

export const LEVELS = Object.freeze({ GOOD: 'good', FAIR: 'fair', POOR: 'poor' });

export const WHO_RADON = 100;

const below = (value, fair, poor) =>
  value < fair ? LEVELS.GOOD : value < poor ? LEVELS.FAIR : LEVELS.POOR;

/**
 * @param {string} key feature key (src/airthings/model.js)
 * @param {number} value
 * @param {number} radonReference Bq/m³
 * @returns {string|null} a LEVELS value, null for a quantity without level
 */
export function levelOf(key, value, radonReference = 300) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  switch (key) {
    case 'radon_short_term':
    case 'radon_long_term':
      return below(value, Math.min(WHO_RADON, radonReference), radonReference);
    case 'co2':
      return below(value, 800, 1000);
    case 'voc':
      return below(value, 250, 2000);
    case 'pm1':
    case 'pm25':
    case 'pm10':
      return below(value, 10, 25);
    case 'humidity':
      if (value < 25 || value >= 70) {
        return LEVELS.POOR;
      }
      return value < 30 || value >= 60 ? LEVELS.FAIR : LEVELS.GOOD;
    default:
      return null;
  }
}

const ORDER = [LEVELS.GOOD, LEVELS.FAIR, LEVELS.POOR];

/** The worst of several levels (nulls ignored), null when none. */
export function worst(levels) {
  let index = -1;
  for (const level of levels) {
    index = Math.max(index, ORDER.indexOf(level));
  }
  return index < 0 ? null : ORDER[index];
}
