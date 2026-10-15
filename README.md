# Airthings for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for
**Airthings** air quality monitors (Wave, Wave Plus, Wave Mini, Wave Radon,
Wave Enhance, View Plus, View Radon, View Pollution, Space…), through the
official [Airthings Consumer API](https://consumer-api-doc.airthings.com/).

> **Developed without the hardware: feedback welcome.** No Airthings sensor
> nor account was used to write it: the code follows the official OpenAPI
> specification of the Consumer API and answers published by other projects.
> The test suite runs against an in-memory Airthings cloud built from them.
> Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-airthings/issues).

Radon is the reason many of these sensors are bought: a natural radioactive
gas, the second cause of lung cancer after smoking, and a real concern in
granite regions (Brittany, the Massif Central, Corsica…). The French and EU
reference level is 300 Bq/m³.

## Features

- **One Gladys device per sensor**, with the values the sensor really
  reports: radon (short-term average, and long-term when the API sends it, in
  Bq/m³), CO₂, VOC, PM1, PM2.5, PM10, temperature, humidity, pressure, light,
  noise, battery, and the **age of the last measurement** (a scene can warn of
  a sensor that stopped uploading).
- **"Air quality" dashboard widget**: every room at a glance (one row each,
  coloured by its worst value, the rooms that need attention first), or one
  sensor with five tiles, its radon curve of the week and the rest as a list.
  Radon is green under 100 Bq/m³ (WHO), red from the reference level of the
  configuration (300 Bq/m³ by default), orange in between.
- **Test the connection** button: the sensors found and the API requests used
  this hour.
- Readings on the integration's own timer, every 5 minutes by default (2 to
  60), within the API quota; values sent to Gladys only when they change.
- Feature names, messages, widget and documentation in English, French,
  German and Spanish.

No scene trigger nor scene action of its own: every use (radon above 300,
CO₂ above 1000, a silent sensor, low batteries) is a threshold on a device
state, which the triggers of Gladys already cover. Nothing can be controlled:
the integration is read-only.

## Requirements

- Gladys Assistant **5.1.0** or later.
- Airthings sensors registered in the Airthings app. The Wave series uploads
  through an Airthings Hub, a View Plus or the phone app over Bluetooth.
- A free **Airthings API client** (client id and secret), created in the
  [Airthings API dashboard](https://consumer-api-doc.airthings.com/dashboard)
  with the Airthings account of the sensors.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-airthings` (or install it from the store).
2. Fill in the client id and secret of your Airthings API client, then press
   **Test the connection**.
3. Add the sensors from the **Discovery** tab, and the **Air quality** widget
   to a dashboard.

The full user documentation is in [`docs/`](docs/en.md) (English, French,
German, Spanish) and is shown by Gladys in the integration screen.

## How it works

- **API**: OAuth client credentials on `accounts-api.airthings.com/v1/token`
  (HTTP Basic credentials, as the
  [airthings-consumer-api](https://github.com/michaelahern/airthings-consumer-api)
  client does), then `GET /v1/accounts`, `/v1/accounts/{id}/devices` and
  `/v1/accounts/{id}/sensors?unit=metric` on `consumer-api.airthings.com`.
  The token and the account id are kept in `/data`, so a restart costs no
  request.
- **Quota**: the API allows 120 requests per hour per API client. One reading
  of the whole account is one request (50 sensors per page), plus the device
  list once an hour: about 13 requests an hour at the default interval. The
  client counts its own requests and never sends more than 100 an hour; a
  `429` pauses every request until the time the API gives.
- **Polling**: the core cannot be trusted to poll external devices
  (GladysAssistant/Gladys#3198, still on 5.2.1), so the container reads the
  cloud on its own timer. The devices still declare a one-minute
  `poll_frequency`, and `onPoll` reads only when the timer has not done it
  for 90 % of a period. A device added in Gladys gets its values from the
  last reading, without any request.
- **States**: `publishChangedStates` of the SDK, with a 6-hour heartbeat. A
  reading older than 3 hours is not published again (the device turns
  "unreachable"), only its growing measurement age.
- **Gladys couples**: Gladys has no radon category; radon is a
  `counter-sensor/integer` in `becquerel-per-cubic-meter`, and PM1 a
  `pm25-sensor/decimal` named "PM1". Every type is shared by at least two
  features of a device, so the Gladys front shows the feature names (it
  falls back to the device name for a feature alone of its type).

## Checked, and what was not

Checked here: the unit tests (an in-memory Airthings cloud and the fake Gladys
of the SDK), the conformity test against the category/type table of the core,
the widget contents against the SDK's copy of the core rules, the store
validator.

Not checked, for lack of hardware, account and network access to the
Airthings cloud from the development session:

- the token request format (HTTP Basic + JSON body, taken from a client used
  in production by homebridge-airthings);
- the exact sensor types and units of every model (the fixtures follow the
  published examples: `bq`, `c`, `pct`, `mbar`, `ppm`, `ppb`, `mgpc`);
- the time zone of the `recorded` date (read as UTC);
- the rate-limit headers of a real `429`.

[`scripts/probe.mjs`](scripts/probe.mjs) checks the real API, read-only and
without printing anything sensitive: `node scripts/probe.mjs` with fake
credentials (a refusal is expected), or with `AIRTHINGS_CLIENT_ID` and
`AIRTHINGS_CLIENT_SECRET` set for a real account.

## Limitations

- Cloud only: no local Bluetooth reading (the Gladys sandbox has no
  Bluetooth, and a bridged network).
- Values are as fresh as the last upload of the sensor: up to 5 minutes or
  more behind for a Wave.
- Mold and virus risk indexes are not read (no Gladys feature for them), nor
  the Renew air purifier controls.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Airthings cloud (`test/helpers/fakeAirthings.js`) built from
the fixtures of `test/fixtures/airthings/` (their origin is in its README).
See [`CLAUDE.md`](CLAUDE.md) for the project rules. Versions, tags and
releases belong to the Release workflow (Actions → Release).

## Credits

- [airthings-consumer-api](https://github.com/michaelahern/airthings-consumer-api)
  and [homebridge-airthings](https://github.com/michaelahern/homebridge-airthings)
  by Michael Ahern (ISC): the vendored OpenAPI specification of the Consumer
  API, the token request, the response examples, the device types.
- [pyAirthings / airthings-cloud](https://github.com/Danielhiversen/pyAirthings)
  by Daniel Hjelseth Høyer (MIT) and Home Assistant's
  [`airthings`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/airthings)
  integration (Apache-2.0): the choice of sensors; Home Assistant issue
  [#140845](https://github.com/home-assistant/core/issues/140845) for real
  answers of a Wave Enhance. No code was copied.
- The architecture and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled),
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Airthings ASA.
"Airthings", "Wave", "View" and "Space" are trademarks of Airthings ASA.
The colours of the widget are an aid, not a health diagnosis: follow the
recommendations of your health authorities (in France, the ASNR and the
regional health agencies).

## License

[Apache-2.0](LICENSE)
