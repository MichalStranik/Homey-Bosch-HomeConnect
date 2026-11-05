# Home Connect (Local) — Homey app

Homey Pro app (SDK v3, TypeScript) that controls and monitors Bosch / Siemens
Home Connect appliances **directly over the local network**. The cloud is used
exactly once — to fetch each appliance's local encryption keys and feature map.
After that the appliances can be blocked from the internet.

- App id: `com.msd.bosch.homeconnect` (see `.homeycompose/app.json`)
- Platform: `local` (Homey Pro), Homey `>=12.9.0`, Node 22
- Locales: `en`, `nl`, `de`

> Independent community project, not affiliated with BSH Hausgeräte GmbH,
> Bosch or Siemens. The local protocol and key-exchange follow
> [hcpy](https://github.com/hcpy2-0/hcpy).

## Supported appliances

| Driver | `DeviceDescription.type` | Highlights |
| :--- | :--- | :--- |
| `oven` | `Oven` | temperature, meat probe, cavity light, fast preheat, alarm clock, pyrolysis, setpoint |
| `dishwasher` | `Dishwasher` | program phase, energy/water forecast, salt/rinse-aid events, Vario Speed, Intensive Zone, Half Load, … |
| `washer` | `Washer` | wash temperature, spin speed (+ numeric mirrors), i-DOS 1/2, Rinse Plus, Less Ironing, Soak, Rinse Hold |
| `dryer` | `Dryer` | drying target, wrinkle guard, gentle, process phase |

Every driver shares a common base: power, operation/door state, active and
selected program, progress, remaining/elapsed time, delayed start, remote
start / remote control / local control flags, child lock, and a common set
of Flow cards (start / start delayed / select / stop / pause / resume
program, acknowledge event, power off, plus triggers and conditions).
See [docs/homey-flow-playbook.md](docs/homey-flow-playbook.md) for Flow recipes.

## Washer statistics

Open **App settings → Statistics**, select a paired washer and a month, year or
all time. The dashboard shows completed/aborted/unverified cycles, favorite
program, typical temperature/spin speed, average duration, SpeedPerfect usage,
a monthly chart, program shares and paginated history.

Each washer also exposes **Completed washes**, **Washes this month** and
**Last completed wash** as device capabilities (existing devices migrate on
app startup). The **Wash statistics updated** Flow trigger supplies completed
total, this-month count, program and outcome (`completed`, `aborted`, `unknown`).
For a cleaning reminder, check `outcome = completed` and use the completed
counter at multiples of 30.

Statistics are stored locally in the device store and survive app restarts.
Tracking begins with this feature; prior program history cannot be imported
from the appliance counter. Pauses/reconnects do not create additional cycles.
Missing terminal states are unverified. Durations exclude partially observed
cycles. Periods use the end date in Homey's time zone; the monthly chart shows
the latest 12 months for all time, or the selected calendar year.
The latest 500 cycle records are kept alongside lifetime/monthly aggregates.
Removing the paired device also removes its statistics. Actual energy/water
consumption is not inferred from forecast percentages.

## How it works (short version)

1. **Key-exchange (once)** — in the app settings page the user signs in to
   SingleKey ID in their own browser and pastes back the `hcauth://` redirect
   URL (or imports an hcpy `devices.json`). The app fetches the paired
   appliances, their TLS-PSK or AES keys and IDDF feature maps, and stores
   them in `homey.settings`.
2. **Pairing** — each driver lists the stored appliances of its type.
3. **Runtime** — each device opens a local websocket to the appliance
   (`wss://…:443` with TLS-PSK, or `ws://…:80` with AES-CBC + HMAC), performs
   the Home Connect handshake and maps feature values onto Homey capabilities.
   mDNS discovery keeps the IP address up to date.

Details: [docs/architecture.md](docs/architecture.md).

## Development

### Prerequisites

- Node.js 22, npm
- [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started/homey-cli): `npm i -g homey`
- A Homey Pro on the same LAN as the appliances

### Setup

```bash
npm install
cp env.example.json env.json   # then fill in HOMECONNECT_CLIENT_ID
```

`env.json` (git-ignored) must contain the OAuth `client_id` of the official
BSH Home Connect mobile app — the same value hcpy uses. Without it the
settings-page login fails with `HOMECONNECT_CLIENT_ID is not set in env.json`.

### Scripts

| Command | What it does |
| :--- | :--- |
| `npm test` | Run automated statistics tests; headless browser test if installed |
| `npm run build` | Type-check / compile TypeScript into `.homeybuild/` |
| `npm run homey-run` | Run the app on your Homey with live logs (`homey app run`) |
| `npm run homey-build` | Build the app (`homey app build`) — generates `app.json` from `.homeycompose/` |
| `npm run homey-validate` | Validate against the `verified` level |

### Install to Homey from Android Studio / IntelliJ

The shared run configuration **Homey - Install** (`.run/`) runs the Gradle task
`installHomey`, which executes `homey app install` with the project-local Homey
CLI. On a fresh checkout it first runs `npm install` (if `node_modules` is
missing) and seeds `app.json` from `.homeycompose/app.json` (the CLI refuses to
start without one; the install then regenerates the full manifest). From a terminal:

```bash
./gradlew installHomey        # Windows: gradlew.bat installHomey
```

The first run asks you to log in (`homey login`) / select a Homey if the CLI
has no session yet. Use `-PnodeExecutable=<path>` to point at a specific Node.

`app.json` in the repo root is **generated** by Homey Compose and git-ignored —
edit `.homeycompose/` and `drivers/*/driver*.compose.json` instead.

### Generators (`tools/`)

One-shot scripts run from the repo root. They **overwrite** their outputs and
are currently **out of sync** with the committed JSON (later changes were made
by hand) — don't re-run them without porting those changes first.

| Script | Output |
| :--- | :--- |
| `tools/generate-capabilities.mjs` | `.homeycompose/capabilities/*.json` + `assets/capability/*.svg` |
| `tools/generate-drivers.mjs` | `drivers/*/driver.compose.json` + `driver.flow.compose.json` (capability lists and Flow cards for all four drivers) |
| `tools/update-existing-icons.mjs` | Icons for capabilities that originally shipped with a placeholder |

### Manual protocol test

`tests/homeconnect-test.js` is a standalone Node script (no Homey needed) that
connects to one appliance from an hcpy `devices.json` and dumps the protocol
traffic — useful for verifying keys and debugging firmware quirks:

```bash
node tests/homeconnect-test.js path/to/devices.json [device-index]
```

### Automated statistics tests

`npm test` runs reducer and mocked-device tests (restart recovery, persistence
failure, counters, time zones, history retention and locale coverage), plus
the settings dashboard in headless Edge/Chrome when available. Set
`STATS_TEST_BROWSER` to a Chromium executable to select another browser.
The browser test skips when no browser is available; no live appliance is used.

## Repository layout

```
app.ts                 App: owns persistent state (appliance list, refresh token)
api.ts                 Web API for settings and paired-washer statistics
settings/index.html    Settings page UI (key-exchange wizard + Statistics tab)
settings/statistics.js Statistics dashboard rendering and period filtering
lib/                   Protocol, crypto, OAuth, discovery, shared driver/device
drivers/<type>/        Per-appliance driver (compose JSON + thin TS subclasses)
.homeycompose/         App manifest, custom capabilities, mDNS discovery
locales/               en / nl / de strings
assets/                App and capability icons
tools/                 Compose/icon generators
tests/                 Protocol diagnostic + automated statistics tests
docs/                  Architecture, Flow playbook, research notes
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — architecture, protocol, data model, extension guide
- [docs/homey-flow-playbook.md](docs/homey-flow-playbook.md) — Flow recipes per appliance
- [docs/appliances/](docs/appliances/) — tested appliance profiles and feature coverage (e.g. [WAX32KH1BY](docs/appliances/WAX32KH1BY.md))
- [docs/official-client-test-plan.md](docs/official-client-test-plan.md) — research note (NL) on the official-app OAuth client
- `README.txt` — Homey App Store description
- `.homeychangelog.json` — release notes shown in Homey
