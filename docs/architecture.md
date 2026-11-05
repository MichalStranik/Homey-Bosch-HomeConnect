# Architecture

This document describes how Home Connect (Local) is put together: the
one-time cloud key-exchange, the local protocol, how appliance features map to
Homey capabilities, and how to extend the app.

## 1. Overview

```
             one-time key-exchange (cloud)                 runtime (LAN only)
 ┌──────────────────┐   ┌────────┐   ┌──────────────┐   ┌─────────────────────┐
 │ settings/        │──▶│ api.ts │──▶│ lib/ oauth + │   │ drivers/<type>      │
 │ index.html       │   │        │   │ discovery +  │   │  └ ApplianceDriver  │
 └──────────────────┘   └───┬────┘   │ iddf         │   │  └ ApplianceDevice ─┼──▶ HomeConnectClient
                            │        └──────────────┘   └──────────▲──────────┘        │
                            ▼                                      │                   ▼
                     app.ts (homey.settings)  ───── DeviceConfig ──┘        home-connect-socket
                       devices[], refreshToken                              (TLS-PSK | AES+HMAC)
                                                                                    │
                                                                              appliance :443/:80
```

| Layer | Files | Responsibility |
| :--- | :--- | :--- |
| UI | `settings/index.html` | Key-exchange wizard; calls `Homey.api()` and listens to realtime events |
| API | `api.ts` | Thin HTTP layer, no domain logic; runs long jobs in the background |
| App state | `app.ts` | Single owner of `homey.settings` (`devices`, `refreshToken`) and `Homey.env.HOMECONNECT_CLIENT_ID` |
| Cloud (once) | `lib/home-connect-oauth.ts`, `lib/home-connect-discovery.ts`, `lib/iddf.ts`, `lib/device-config.ts` | OAuth+PKCE, appliance/key/IDDF download, normalization |
| Transport | `lib/home-connect-socket.ts`, `lib/aes-hmac-codec.ts` | Opens the websocket over TLS-PSK or plain TCP + AES framing |
| Protocol | `lib/home-connect-client.ts` | Handshake, request/response, UID ⇄ name decoding |
| Homey glue | `lib/appliance-driver.ts`, `lib/appliance-device.ts` | Pairing, Flow cards, capability mapping, reconnect |
| Drivers | `drivers/<type>/` | Compose manifests + small subclasses with type-specific Flow cards and event maps |

## 2. One-time key-exchange

Implemented in `api.ts` + `lib/`. Endpoints (declared in `.homeycompose/app.json`):

| API | Route | Purpose |
| :--- | :--- | :--- |
| `getStatus` | `GET /status` | Stored appliances + whether a refresh token exists |
| `startManualAuth` | `POST /manual/start` | Create PKCE pair, return `authorizeUrl` + `pkceId` |
| `submitRedirectUrl` | `POST /manual/submit` | Parse pasted `hcauth://auth/prod?code=…&state=…`, verify state, run exchange in background |
| `importDevices` | `POST /import` | Validate and store an hcpy `devices.json` verbatim (no cloud) |
| `refreshDevices` | `POST /refresh` | Re-run discovery using the stored refresh token |
| `clearDevices` | `POST /clear` | Remove stored state |

**Why the paste-back flow:** the OAuth `redirect_uri` is the custom scheme
`hcauth://auth/prod` (as in the official BSH app), which a browser cannot
follow, and the SingleKey login page is hCaptcha-protected and host-locked, so
it cannot be proxied. The user logs in in their own browser and copies the
failed-redirect URL back.

**Background runs:** token exchange + discovery can exceed Homey's settings-API
timeout. `runInBackground()` returns a `runId` immediately and reports via
realtime events `homeconnect:run:progress`, `homeconnect:run:done`,
`homeconnect:run:error`.

PKCE sessions live in memory (`manualSessions`) and are lost on app restart —
the user just generates a new link.

**Discovery** (`lib/home-connect-discovery.ts`, mirrors hcpy `hc-login.py`):

1. `sub` claim from the JWT access token = account id.
2. `GET {asset}/api/account/v2/accounts/{sub}/paired-appliances` — tries EU, then NA.
3. Per appliance: `GET …/appliances/{haId}/encryption-information` → `tls.key` **or** `aes.key + aes.iv`.
4. Per appliance: `GET …/iddf/v1/iddf/{haId}` → ZIP with `*FeatureMapping.xml` + `*DeviceDescription.xml`, parsed by `lib/iddf.ts`.

## 3. Data model (`lib/types.ts`)

`DeviceConfig` is the hcpy `devices.json` entry plus a guaranteed `haId`:

| Field | Meaning |
| :--- | :--- |
| `name` | Lower-case appliance type |
| `host` | Hostname / IP. TLS: `BRAND-Type-<haId>`; AES: `<haId>`. Updated by mDNS |
| `key` | base64url PSK (TLS) or AES root key |
| `iv` | base64url IV — **its presence selects the AES variant** |
| `description` | `type`, `brand`, `model`, `version`, `revision` from the IDDF |
| `features` | `uid → { name, access, available, values, min, max, … }` |
| `haId` | Stable id; Homey device `data.id`. Derived from `host` for imported configs (`deriveHaId`) |

Storage:

- `homey.settings.devices` — the whole `DeviceConfig[]` (source of truth).
- Device store `config` — copy of its own `DeviceConfig`, refreshed on `onInit`
  when keys / IDDF version / features change in the app list; a
  discovery-resolved `host` is kept.

## 4. Local transport

`openConnection()` in `lib/home-connect-socket.ts`:

| Variant | Condition | Connection |
| :--- | :--- | :--- |
| TLS-PSK | no `iv` | `wss://host:443/homeconnect`, TLS 1.2 only, PSK identity `HCCOM_Local_App`, ciphers `ECDHE-PSK-CHACHA20-POLY1305:PSK-AES128-CBC-SHA:PSK` |
| AES | `iv` present | `ws://host:80/homeconnect`, every frame encrypted by `AesHmacCodec` |

The socket is pre-opened and injected into `ws` through a custom agent, so `ws`
only performs the HTTP upgrade. No `Origin` header is sent.

`AesHmacCodec`: `encKey = HMAC(psk,"ENC")`, `macKey = HMAC(psk,"MAC")`,
AES-256-CBC with chained IV (last ciphertext block → next IV), 16-byte
truncated HMAC-SHA256 chained over previous frames, direction bytes `E`
(0x45, out) / `C` (0x43, in). Padding is custom — **not PKCS#7**.

## 5. Protocol (`HomeConnectClient`)

JSON messages: `{ sID, msgID, resource, version, action, data?, code? }`.

Handshake — **the client must never speak first**:

1. Appliance `POST /ei/initialValues` → adopt `sID` and `edMsgID` as tx counter, reply with identity.
2. Client `GET /ci/services` → store service versions (used for all later requests).
3. Client sends `/iz/info` or `/ci/authentication` + `/ci/info`, `NOTIFY /ei/deviceReady`, `/ni/info` (if present), `GET /ro/allMandatoryValues`, `GET /ro/allDescriptionChanges` → emits `connected`.

Afterwards:

| Resource | Handling |
| :--- | :--- |
| `/ro/values`, `/ro/allMandatoryValues` | Decoded to `{ featureName: value }` and emitted as `values`. Enum values resolved via `feature.values`; `ActiveProgram` / `SelectedProgram` / `BaseProgram` resolved via the referenced program UID |
| `/ro/descriptionChange`, `/ro/allDescriptionChanges` | Patch live `access` / `available` / `min` / `max` / `default`; any embedded `value` is emitted as a value |
| `/ro/activeProgram`, `/ro/selectedProgram` | Tracked requests (10 s timeout); `code` in RESPONSE ⇒ rejection |
| any other appliance `POST` | Must be acknowledged with an empty RESPONSE or the stream stalls |

Writes via `/ro/values` are **fire-and-forget**: some firmware answers 400
even though the change applies, and the real state arrives as a NOTIFY.

Events: `connected`, `values`, `description`, `raw`, `close`, `error`.

## 6. Homey integration

### ApplianceDriver (`lib/appliance-driver.ts`)

Subclass sets `applianceType` (matched case-insensitively against
`description.type`) and `cardPrefix`. The base class registers all common
Flow cards as `<cardPrefix>_<id>` (Flow ids must be unique app-wide), and
`onPairListDevices()` lists matching stored appliances (`name`, `data.id = haId`).

Optional `eventMap()` maps BSH event features (e.g.
`Dishwasher.Event.SaltNearlyEmpty`) to a trigger key; trigger card id is the
snake_case form, e.g. `idosLow` → `washer_idos_low`.

### ApplianceDevice (`lib/appliance-device.ts`)

- **`CAPABILITY_MAP`** — feature name → `{ capability, decode, encode? }`,
  shared by all types. Rows apply only if the driver declares the capability.
  Rows with `encode` are writable and get a capability listener. Several
  feature names may map to one capability (model-specific names such as
  `LaundryCare.Washer` vs `LaundryCare.Common` VarioPerfect); writes use the
  one the appliance has.
- **`NUMERIC_MIRRORS`** — enum capability → numeric companion
  (`spin_speed` → `spin_speed_rpm`, `wash_temperature` → `wash_temperature_celsius`).
- **Capability sync** — on init, declared capabilities whose feature is
  missing from the startup feature snapshot are removed. Live description
  changes never add/remove capabilities (prevents tile flicker).
- **Write gating** — `isFeatureWritableNow()` uses the live `access` / `available`.
- **Running-state handling** — remaining/elapsed time and start-in-relative are
  ignored unless the program is running (`Run`, `DelayedStart`, `Pause`,
  `ActionRequired`); `reconcileDerivedState()` clears progress, times and
  phase when it stops (the program name is kept on `Finished`).
- **Events** — fire on `Off → Present` edge, then auto `AcknowledgeEvent`.
  Unmapped events fire `<prefix>_error_occurred` with `error_code`, except
  IDDF `level` `info`/`hint` (e.g. `ProgramFinished`).
- **Program control** — `listPrograms()` (Flow autocomplete from features
  containing `.Program.`), `startProgram()` (optional temperature, duration,
  delay via `StartInRelative`; refused if remote start is off),
  `selectProgram()`, `sendCommand()` (Abort / Pause / Resume).
- **Connection** — reconnect every 15 s after close/failure; a generation
  counter drops events from stale clients. mDNS (`homeconnect` service,
  id = haId) updates `host` and reconnects.

## 7. Extending the app

### Add a capability to an existing appliance

1. Add `.homeycompose/capabilities/<id>.json` (+ icon) by hand — the
   generators in `tools/` are out of sync (see Known caveats).
2. Add it to the driver's `driver.compose.json` capability list.
3. Add a `CAPABILITY_MAP` row: BSH feature name → capability + decoder (+ encoder if writable).
4. Add translations to `locales/*.json` if any new strings are used.
5. `npm run build && npm run homey-validate`.

### Add a new appliance type

1. `drivers/<type>/driver.ts`: extend `ApplianceDriver`, set `applianceType`
   (the IDDF `type`, e.g. `CoffeeMaker`) and `cardPrefix`; add `eventMap()` and
   extra Flow listeners if needed.
2. `drivers/<type>/device.ts`: `class XDevice extends ApplianceDevice {}`.
3. Compose files: capabilities, `discovery: "homeconnect-mdns"`, pairing
   (`list_devices`), and **all** common Flow cards with the new prefix — the
   base driver calls `getDeviceTriggerCard()` for each of them.
4. Icons/images under `drivers/<type>/assets/`.

## 8. Known caveats

- `package.json` version (`1.1.0`) lags behind `.homeycompose/app.json` (`1.2.0`); the latter is authoritative for Homey.
- `decodePercent` has a stale comment about dividing by 100 — values are passed through as-is.
- A `DEBUG ProgramProgress` log line in `applyValues()` is still active.
- `tests/` contains only a manual script; there are no automated tests.
- `tools/generate-*.mjs` are **out of sync** with the committed capability and driver JSON (later changes were made directly in the JSON). Re-running them reverts those changes — edit the JSON files by hand.
