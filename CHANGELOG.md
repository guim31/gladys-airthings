# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Airthings air quality monitors in Gladys, through the official Airthings
  Consumer API (a free API client: client id and secret): one device per
  sensor (Wave, Wave Plus, Wave Mini, Wave Radon, Wave Enhance, View Plus,
  View Radon, View Pollution, Space…), with the values it really reports:
  radon (short term, and long term when the API sends it), CO₂, VOC, PM1,
  PM2.5, PM10, temperature, humidity, pressure, light, noise, battery, and
  the age of the last measurement (to detect a sensor that stopped
  uploading).
- Readings every 5 minutes by default (2 to 60), one request for the whole
  account, about 13 of the 120 requests an hour the API allows; the
  integration never goes beyond 100 an hour and waits when the API says
  "too many requests". Values are sent to Gladys only when they change, and
  again every 6 hours.
- "Air quality" dashboard widget: every room at a glance, or one sensor with
  its tiles and the radon curve of the week, with a colour code for radon
  (green under 100 Bq/m³, red from the reference level of the configuration,
  300 Bq/m³ by default as in France and the EU).
- "Test the connection" button: the sensors found and the API requests used
  this hour.
- Feature names, messages, widget and documentation in English, French,
  German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-airthings/commits/main
