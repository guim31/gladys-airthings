# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the client id and client secret of the Airthings API client
  are fields of the Gladys configuration (the secret is a `secret` field).
  The integration reads them from Gladys, keeps them in memory, sends them
  only to the Airthings token endpoint (`https://accounts-api.airthings.com`,
  HTTP Basic authentication over HTTPS), and never writes them to `/data`
  nor to the logs.
- **Stored in `/data`**: `airthings-state.json` (owner-only permissions):
  the access token of the Airthings API and its expiry (it gives read access
  to the sensor values of the account for a few hours), the Airthings
  account id, a truncated SHA-256 fingerprint of the credentials (to tell
  whose token it is), and per sensor serial number the features already
  seen. Nothing else.
- **Network**: HTTPS requests to `accounts-api.airthings.com` and
  `consumer-api.airthings.com` only, read-only (`GET` on the Consumer API).
  The integration opens no port, uses no local network access and follows no
  redirect.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Airthings cloud and devices (see
[Airthings](https://www.airthings.com/)), and the other devices and services
of your network.
