# Bosch WAX32KH1BY — washing machine (Serie 8)

Reference appliance for the `washer` driver: owned and tested by the maintainer.
The feature list below comes from the appliance's IDDF (stored in the app
settings after the key-exchange) and was audited against
`lib/appliance-device.ts` on 2026-11-05.

## Identity & connection

| Item | Value |
| :--- | :--- |
| Brand / type / VIB | BOSCH / `Washer` / `WAX32KH1BY` |
| haId | `BOSCH-WAX32KH1BY-68A40E4E6EA7` (MAC `68A40E4E6EA7`) |
| IDDF version / revision | 2 / 0 |
| Firmware (mDNS `vers` / `info`) | `2.4132-2.10.1.13125` / `W_1.1.14_1.7.0.0_1.0.0_OS4110` |
| Protocol variant | **AES** (`iv` present) → `ws://<ip>:80/homeconnect`, port 443 closed |
| mDNS | `_homeconnect._tcp`, instance `Washer BOSCH WAX32KH1BY`, TXT `id` = haId, target `BOSCH-WAX32KH1BY-68A40E4E6EA7.local` |
| Observed LAN address | `192.168.0.67` (DHCP — reservation recommended) |

The bare host name is **not** resolvable by plain DNS from Homey; the app
relies on mDNS discovery (`{{txt.id}}`) to learn the IP.

## Coverage

Legend: ✅ supported · ⚠️ supported with a defect · ❌ not supported.
"avail" = `available` attribute in the IDDF at audit time (options are
program-dependent and become available when a program is selected).

### Status & settings

| Feature (UID) | Access / avail | App | Notes |
| :--- | :--- | :--- | :--- |
| `BSH.Common.Status.OperationState` (552) | read / ✓ | ✅ | |
| `BSH.Common.Status.DoorState` (527) | read / ✓ | ⚠️ | value `Ajar` is missing from the `homeconnect_door_state` enum → write fails, tile stays stale |
| `BSH.Common.Setting.PowerState` (539) | **read** / ✓ | ⚠️ | `onoff` is shown as switchable, but the appliance does not accept writes |
| `BSH.Common.Status.RemoteControlStartAllowed` (517) | read / ✓ | ✅ | |
| `BSH.Common.Status.RemoteControlActive` (523) | read / ✓ | ✅ | |
| `BSH.Common.Status.LocalControlActive` (535) | read / ✓ | ✅ | |
| `BSH.Common.Setting.ChildLock` (524) | none / ✗ | ✅ | capability present, stays empty on this model |
| `BSH.Common.Option.RemainingProgramTime` (544) | read / ✓ | ✅ | |
| `BSH.Common.Option.ProgramProgress` (542) | none / ✗ | ✅ | |
| `BSH.Common.Option.EnergyForecast` (561) / `WaterForecast` (562) | none / ✗ | ✅ | |
| `BSH.Common.Option.EstimatedTotalProgramTime` (531) | read / ✓ | ❌ | |
| `BSH.Common.Option.RemainingProgramTimeIsEstimated` (549) | read / ✓ | ❌ | |
| `BSH.Common.Option.FinishInRelative` (551) | none / ✓ | ❌ | **this model has no `StartInRelative`** — the "start program delayed" Flow card fails; washers schedule via "finish in" |
| `LaundryCare.Common.Option.ProcessPhase` (27142) | none / ✗ | ❌ | washer phase not shown; `homeconnect_program_phase` is mapped only to the dishwasher feature and its enum doesn't fit |
| `BSH.Common.Status.WiFiSignalStrength` (27) | read / ✓ | ❌ | |
| `BSH.Common.Status.BackendConnected` (5) | read / ✓ | ❌ | would show whether the cloud connection is up |
| `LaundryCare.Washer.Status.IDos1FillLevel` / `IDos2FillLevel` (8193/8194) | read / ✗ | ❌ | |
| `LaundryCare.Common.Status.LoadInformation` (10754) | read / ✗ | ❌ | |
| LaundryCare settings (signal volumes, auto power-off, door light ring, brightness, i-DOS content/base level, drum-clean reminder; 12289–14863) | none / ✗ | ❌ | not writable locally at audit time |

### Options

| Feature (UID) | Wire type | App | Notes |
| :--- | :--- | :--- | :--- |
| `LaundryCare.Washer.Option.Temperature` (24577) | enum | ⚠️ | enum lacks `Auto`, `Max` (and US `Ul*` values) |
| `LaundryCare.Washer.Option.SpinSpeed` (24578) | enum | ⚠️ | enum lacks `RPM700`, `RPM900`, `RPM1500`, `Auto`, `Max` (and `Ul*`); the rpm mirror is skipped too |
| `LaundryCare.Common.Option.VarioPerfect` (27137) | enum Off/EcoPerfect/SpeedPerfect | ❌ | app maps only `LaundryCare.Washer.Option.VarioPerfect`; this model uses the `Common` name |
| `LaundryCare.Washer.Option.RinsePlus` (24583) | **enum** Off/Plus1–3 | ⚠️ | mapped as boolean → decodes `Plus1–3` as false, writes true/false to an enum |
| `LaundryCare.Washer.Option.MultipleSoak` (24595) | **enum** Off/Plus1–3 | ⚠️ | same boolean-vs-enum mismatch |
| `WaterPlus`, `Prewash`, `RinseHold`, `LessIroning`, `Soak`, `SpeedPerfect`, `IDos1.Active`, `IDos2.Active` | bool | ✅ | |
| `Stains`, `SilentWash`, `IntensivePlus`, `Disinfectant`, `HygienicSteam`, `HygienicSteamIntensity`, `WaterAndRinsePlus`, `WaterAndRinsePlus1`, `RinsePlus1`, `RinsePlus3`, `IDos1DosingLevel`, `IDos2DosingLevel`, `LoadRecommendation`, `LowTemperatureHygiene` | mixed | ❌ | |

### Commands & programs

| Feature | App | Notes |
| :--- | :--- | :--- |
| `AbortProgram`, `PauseProgram`, `ResumeProgram` | ✅ | access `none` until remote control allows it |
| `AcknowledgeEvent` | ✅ | |
| `RejectEvent` | ❌ | needed to answer decision events (`ReleaseRinseHoldPending`) |
| Programs: Cotton, Cotton.Eco4060, Cotton.Colour, EasyCare, Mix, DelicatesSilk, Wool, ShirtsBlouses, Auto30, DrumClean, Rinse, SportFitness, Super1530, SpinDrain, Memory1–8 | ✅ | offered in Flow autocomplete; remote start requires *Remote Start* enabled on the machine |

### Events

| Event | App | Notes |
| :--- | :--- | :--- |
| `IDos1FillLevelPoor`, `IDos2FillLevelPoor` | ✅ | `washer_idos_low` |
| `AquaStopOccured`, `LowWaterPressure`, `SoftwareUpdateAvailable` | ✅ | |
| `BSH.Common.Event.ProgramFinished`, `ProgramAborted` | ⚠️ | unmapped → fire **`washer_error_occurred`** on every finished/aborted wash (false error) |
| `DelayedShutdown`, `DelayedShutdownCanceled`, `DrumCleanReminder`, `SpinAbort`, `FoamDetection`, `DoorNotUnlockable`, `ReleaseRinseHoldPending`, `CustomerServiceRequest`, `HomeConnectApplianceDataMissing` (level hint/info) | ⚠️ | unmapped → reported as errors |
| `PumpError`, `FatalErrorOccured`, `IDosUnitDefect`, `IDosOpenTray`, `DoorNotLockable`, `DoorOpen`, `WaterLevelTooHigh`, `SupplyVoltageTooLow` (warning/alert/critical) | ✅ | via generic `washer_error_occurred` with `error_code` |

## Recommended fixes (priority)

1. Don't treat `hint`/`info` events (incl. `ProgramFinished`/`ProgramAborted`) as errors — use the IDDF `level`.
2. Extend enums: door `Ajar`; temperature `Auto`/`Max`; spin `RPM700`/`RPM900`/`RPM1500`/`Auto`/`Max`.
3. Map `LaundryCare.Common.Option.VarioPerfect` → `homeconnect_vario_perfect`.
4. RinsePlus / MultipleSoak as enums (Off/Plus1–3).
5. Washer process phase (`LaundryCare.Common.Option.ProcessPhase`) as its own capability.
6. Delayed start via `FinishInRelative` ("ready in N minutes") for washers/dryers.
7. Nice to have: estimated total time, Wi-Fi signal, cloud-connected flag, i-DOS fill level, `onoff` read-only when PowerState is read-only.
