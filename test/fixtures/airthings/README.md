# Airthings Consumer API fixtures

Shapes and values come from published material, anonymized (invented serial
numbers, room names and account id, no real token):

- `devices.json`, `sensors.json`, `accounts.json`, `token.json`: the schemas
  of the official OpenAPI specification of the Consumer API
  (`vendor-docs/openapi.yaml` in
  [michaelahern/airthings-consumer-api](https://github.com/michaelahern/airthings-consumer-api),
  ISC), with the units of its README example (`bq`, `pct`, `c`, `ppm`, `ppb`,
  `mgpc`) and of the real answers posted in
  [home-assistant/core#140845](https://github.com/home-assistant/core/issues/140845):
  a Wave Enhance announcing `sla` and `lux` in its device list but sending
  neither, humidity `29 pct`, pressure `975 mbar`. The device types and their
  sensor lists follow `src/device.ts` of
  [michaelahern/homebridge-airthings](https://github.com/michaelahern/homebridge-airthings)
  (ISC). The hub (`HUB`, no sensor) and a Wave Mini `mold` risk index show
  what the integration leaves out.
- `sensors-imperial.json`: the imperial example of the same README, word for
  word (`pci`, `f`, `pa`).
- `rate-limit.json`: the `Error` schema of the specification, for a 429.

`radonLongTermAvg` appears in no published answer: the tests that use it
build it inline.
