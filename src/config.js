// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Minutes between two readings of the Airthings cloud. The Consumer API
// allows 120 requests per hour and the sensors upload every 2.5 to 5 minutes
// (View series) or 5 minutes and more (Wave series, through a hub or a phone):
// one minute would only read the same values again.
export const REFRESH_MINUTES = ['2', '5', '10', '15', '30', '60'];

// Radon reference level (Bq/m³) that colours the widget red: 300 in France
// and in the EU directive 2013/59/Euratom, 200 in some countries of the EU,
// 148 the US EPA action level (4 pCi/L), 100 the WHO recommendation.
export const RADON_REFERENCES = ['300', '200', '148', '100'];

export const DEFAULT_CONFIG = {
  client_id: '',
  client_secret: '',
  refresh_minutes: '5',
  radon_reference: '300',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  // Copied from the Airthings dashboard: surrounding blanks are never part of them.
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');

  return {
    clientId: text('client_id'),
    clientSecret: text('client_secret'),
    refreshMs: Number(pick('refresh_minutes', REFRESH_MINUTES)) * 60_000,
    radonReference: Number(pick('radon_reference', RADON_REFERENCES)),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Both credentials are typed. */
export const hasCredentials = (config) => Boolean(config.clientId && config.clientSecret);
