"use strict";

import { ApplianceDevice } from "../../lib/appliance-device";

const SPIN_SPEED_FEATURE = "LaundryCare.Washer.Option.SpinSpeed";
const SELECTED_PROGRAM_FEATURE = "BSH.Common.Root.SelectedProgram";

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

  protected onFeatureValue(featureName: string, value: unknown): void {
    if (featureName === SPIN_SPEED_FEATURE) {
      this.enforceSpinLimit(value);
    } else if (featureName === SELECTED_PROGRAM_FEATURE) {
      // A new program brings its own default spin speed; the appliance may
      // report it before or after the program, so re-check either way.
      this.lastSpinLimitWrite = null;
      this.enforceSpinLimit(this.getCapabilityValue("homeconnect_spin_speed"));
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
