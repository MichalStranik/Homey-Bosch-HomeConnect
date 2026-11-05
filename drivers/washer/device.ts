"use strict";

import { ApplianceDevice } from "../../lib/appliance-device";

const SPIN_SPEED_FEATURE = "LaundryCare.Washer.Option.SpinSpeed";
const SELECTED_PROGRAM_FEATURE = "BSH.Common.Root.SelectedProgram";
const REMOTE_CONTROL_FEATURE = "BSH.Common.Status.RemoteControlActive";

/**
 * Before the program starts the spin speed can still be changed; once it runs
 * the appliance locks the option, so the limit is only enforced in these.
 */
const ADJUSTABLE_STATES = new Set(["Inactive", "Ready", "DelayedStart"]);

interface SpinLimitSettings {
  spin_limit_enabled?: boolean;
  spin_limit_rpm?: string;
}

/** "RPM1400" -> 1400; Auto/Max -> Infinity (appliance may go to its maximum); Off -> 0. */
function spinRpm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (value === "Auto" || value === "Max") return Number.POSITIVE_INFINITY;
  if (value === "Off") return 0;
  const match = value.match(/^RPM(\d+)$/);
  return match ? Number(match[1]) : null;
}

class WasherDevice extends ApplianceDevice {
  /**
   * Program + value + limit of a write the appliance hasn't confirmed yet, so
   * a silently refused write isn't repeated. Cleared as soon as the spin
   * speed is within the limit, so every new excess is handled again.
   */
  private lastSpinLimitWrite: string | null = null;

  /** Last selected program seen, to tell a real program change from a repeat. */
  private lastSelectedProgram: unknown = undefined;

  /** Last RemoteControlActive seen; the washer drops it while operated by hand. */
  private lastRemoteControl: unknown = undefined;

  protected onFeatureValue(featureName: string, value: unknown): void {
    if (featureName === SPIN_SPEED_FEATURE) {
      this.enforceSpinLimit(value);
    } else if (featureName === SELECTED_PROGRAM_FEATURE) {
      // The full state repeats the selected program; only react to a change.
      if (value === this.lastSelectedProgram) return;
      this.lastSelectedProgram = value;
      // A new program brings its own default spin speed. The appliance may
      // report it before or after the program, or not at all when it equals
      // the previous one - so re-check now and re-read the state to get the
      // spin speed that actually applies to the new program.
      this.lastSpinLimitWrite = null;
      this.enforceSpinLimit(this.getCapabilityValue("homeconnect_spin_speed"));
      if (this.isSpinLimitEnabled()) this.scheduleValueRefresh();
    } else if (featureName === REMOTE_CONTROL_FEATURE) {
      const regained = value === true && this.lastRemoteControl !== true;
      this.lastRemoteControl = value;
      // Turning the dial switches remote control off for ~20 s; once it is
      // back, apply the limit to whatever was selected meanwhile.
      if (regained) {
        this.lastSpinLimitWrite = null;
        this.enforceSpinLimit(this.getCapabilityValue("homeconnect_spin_speed"));
      }
    }
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: SpinLimitSettings;
    changedKeys: string[];
  }): Promise<void> {
    if (!changedKeys.some((key) => key.startsWith("spin_limit_"))) return;
    this.lastSpinLimitWrite = null;
    this.enforceSpinLimit(this.getCapabilityValue("homeconnect_spin_speed"), newSettings);
  }

  private isSpinLimitEnabled(): boolean {
    return (this.getSettings() as SpinLimitSettings).spin_limit_enabled === true;
  }

  /**
   * Spin speed limit from the advanced settings: when the selected spin speed
   * is above the limit (Auto/Max count as above), write the limit back while
   * the program can still be adjusted.
   */
  private enforceSpinLimit(
    value: unknown,
    settings: SpinLimitSettings = this.getSettings() as SpinLimitSettings,
  ): void {
    if (!settings.spin_limit_enabled || !settings.spin_limit_rpm) return;
    const limit = spinRpm(settings.spin_limit_rpm);
    const current = spinRpm(value);
    if (limit == null || current == null) return;
    if (current <= limit) {
      this.lastSpinLimitWrite = null;
      return;
    }

    const state = this.getCapabilityValue("homeconnect_operation_state");
    if (state != null && !ADJUSTABLE_STATES.has(String(state))) return;

    // While the washer is operated by hand it ignores remote writes; wait for
    // remote control to come back (handled in onFeatureValue).
    const remoteControl =
      this.lastRemoteControl !== undefined
        ? this.lastRemoteControl
        : this.getCapabilityValue("homeconnect_remote_control_active");
    if (remoteControl === false) return;

    const program = this.getCapabilityValue("homeconnect_selected_program");
    const key = `${program}|${String(value)}|${settings.spin_limit_rpm}`;
    if (key === this.lastSpinLimitWrite) return;

    this.setMappedCapabilityValue("homeconnect_spin_speed", settings.spin_limit_rpm)
      .then(() => {
        this.lastSpinLimitWrite = key;
        this.log(`spin limit: ${String(value)} -> ${settings.spin_limit_rpm} (program ${program})`);
      })
      .catch((err: Error) => {
        // Usually "not available right now" (remote control off / option
        // locked); the next value update retries.
        this.log(`spin limit not applied: ${err.message}`);
      });
  }
}

module.exports = WasherDevice;
