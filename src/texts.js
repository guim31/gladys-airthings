// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './airthings/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noCredentials: {
    en: 'Enter the client id and secret of your Airthings API client in the configuration.',
    fr: "Saisissez l'identifiant et le secret de votre client d'API Airthings dans la configuration.",
    de: 'Gib die Client-ID und das Secret deines Airthings-API-Clients in der Konfiguration ein.',
    es: 'Introduzca el ID y el secreto de su cliente de API de Airthings en la configuración.',
  },
  noSensor: {
    en: 'Connected, but this Airthings account has no sensor.',
    fr: "Connecté, mais ce compte Airthings n'a aucun capteur.",
    de: 'Verbunden, aber dieses Airthings-Konto hat keinen Sensor.',
    es: 'Conectado, pero esta cuenta de Airthings no tiene ningún sensor.',
  },
};

// One short explanation per error kind (src/airthings/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.AUTH]: {
    en: 'client id or secret refused: check them in the Airthings API dashboard',
    fr: "identifiant ou secret refusé : vérifiez-les sur le tableau de bord de l'API Airthings",
    de: 'Client-ID oder Secret abgelehnt: Prüfe sie im Dashboard der Airthings-API',
    es: 'ID o secreto rechazado: compruébelos en el panel de la API de Airthings',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'request quota of the Airthings API reached, readings resume later',
    fr: "quota de requêtes de l'API Airthings atteint, la relève reprendra plus tard",
    de: 'Anfragekontingent der Airthings-API erreicht, die Abfrage geht später weiter',
    es: 'cuota de solicitudes de la API de Airthings alcanzada, la lectura se reanudará',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the Airthings cloud does not answer',
    fr: 'le cloud Airthings ne répond pas',
    de: 'die Airthings-Cloud antwortet nicht',
    es: 'la nube de Airthings no responde',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'the Airthings cloud answers with an error',
    fr: 'le cloud Airthings répond par une erreur',
    de: 'die Airthings-Cloud antwortet mit einem Fehler',
    es: 'la nube de Airthings responde con un error',
  },
  [ERROR_KINDS.PROTOCOL]: {
    en: 'unexpected answer from the Airthings cloud',
    fr: 'réponse inattendue du cloud Airthings',
    de: 'unerwartete Antwort der Airthings-Cloud',
    es: 'respuesta inesperada de la nube de Airthings',
  },
  [ERROR_KINDS.NO_ACCOUNT]: {
    en: 'no Airthings account linked to this API client',
    fr: "aucun compte Airthings lié à ce client d'API",
    de: 'kein Airthings-Konto mit diesem API-Client verknüpft',
    es: 'ninguna cuenta de Airthings vinculada a este cliente de API',
  },
};

// "Test the connection" report (≤ 200 characters once filled).
export const REPORT_TEXT = {
  en: {
    ok: (count, names) => `Connected: ${count} sensor(s)${names ? ` (${names})` : ''}.`,
    quota: (used, limit) => `API requests this hour: ${used} of ${limit}.`,
    failed: (reason) => `Connection failed: ${reason}.`,
  },
  fr: {
    ok: (count, names) => `Connecté : ${count} capteur(s)${names ? ` (${names})` : ''}.`,
    quota: (used, limit) => `Requêtes d'API cette heure : ${used} sur ${limit}.`,
    failed: (reason) => `Échec de la connexion : ${reason}.`,
  },
  de: {
    ok: (count, names) => `Verbunden: ${count} Sensor(en)${names ? ` (${names})` : ''}.`,
    quota: (used, limit) => `API-Anfragen in dieser Stunde: ${used} von ${limit}.`,
    failed: (reason) => `Verbindung fehlgeschlagen: ${reason}.`,
  },
  es: {
    ok: (count, names) => `Conectado: ${count} sensor(es)${names ? ` (${names})` : ''}.`,
    quota: (used, limit) => `Solicitudes de API en esta hora: ${used} de ${limit}.`,
    failed: (reason) => `Fallo de la conexión: ${reason}.`,
  },
};

/** The text of a multi-language object in a language, English as fallback. */
export const pick = (text, language) => text?.[language] ?? text?.en ?? '';

/** Every language of a multi-language table, rendered by `render(text, language)`. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, render(language)]));
