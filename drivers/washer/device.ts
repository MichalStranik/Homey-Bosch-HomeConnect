"use strict";

import { ApplianceDevice } from "../../lib/appliance-device";
import {
  WashStatistics, STATISTICS_CAPABILITIES, monthKey, newStatistics, observeStatistics,
} from "../../lib/wash-statistics";

const SPIN_SPEED_FEATURE = "LaundryCare.Washer.Option.SpinSpeed";
const SELECTED_PROGRAM_FEATURE = "BSH.Common.Root.SelectedProgram";
const REMOTE_CONTROL_FEATURE = "BSH.Common.Status.RemoteControlActive";

/**
 * States in which the spin limit is applied: before the start, and while the
 * program runs - the WAX32KH1BY accepts a spin speed write during Run
 * (verified live: Rinse 1200 -> 800), it just doesn't report the new value
 * back (see setMappedCapabilityValue). The program is never paused for it.
 */
const ADJUSTABLE_STATES = new Set(["Inactive", "Ready", "DelayedStart", "Run"]);

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
  private statistics!: WashStatistics;
  private continuousObservation = false;
  private statisticsTimer: NodeJS.Timeout | null = null;
  private statisticsPublishQueue: Promise<void> = Promise.resolve();

  async onInit(): Promise<void> {
    const saved = this.getStoreValue("washStatistics") as WashStatistics | undefined;
    this.statistics = saved?.version === 1 ? saved : newStatistics();
    if (!saved) await this.setStoreValue("washStatistics", this.statistics);
    for (const capability of STATISTICS_CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
    await this.publishStatistics();
    await super.onInit();
    // Keep this-month counter correct even if the washer is off at midnight.
    this.statisticsTimer = this.homey.setInterval(() => {
      this.publishStatistics().catch(this.error);
    }, 60_000);
  }

  protected onConnectionOpened(): void {
    this.continuousObservation = false;
  }

  protected async onValuesReceived(values: Record<string, unknown>): Promise<void> {
    const previous = this.statistics;
    const next = observeStatistics(previous, values, new Date(), this.homey.clock.getTimezone(),
      this.continuousObservation);
    if (Object.hasOwn(values, "BSH.Common.Status.OperationState")) this.continuousObservation = true;
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    // Commit atomically before publishing counters or firing Flow events.
    await this.setStoreValue("washStatistics", next);
    this.statistics = next;
    await this.publishStatistics();
    if (next.history[0]?.endedAt !== previous.history[0]?.endedAt ||
        next.totals.completed !== previous.totals.completed ||
        next.totals.aborted !== previous.totals.aborted ||
        next.totals.unknown !== previous.totals.unknown) {
      await this.homey.flow.getDeviceTriggerCard("washer_statistics_updated").trigger(this, {
        completed: next.totals.completed,
        month: next.months[monthKey(new Date(), this.homey.clock.getTimezone())]?.completed ?? 0,
        program: next.history[0]?.program ?? "",
        outcome: next.history[0]?.outcome ?? "",
      }, {}).catch(this.error);
    }
  }

  getWashStatistics(): WashStatistics {
    return structuredClone(this.statistics);
  }

  private publishStatistics(): Promise<void> {
    // The month-rollover timer and protocol stream may both publish at once.
    const pending = this.statisticsPublishQueue.then(() => this.updateStatisticsCapabilities());
    this.statisticsPublishQueue = pending.catch(this.error);
    return pending;
  }

  private async updateStatisticsCapabilities(): Promise<void> {
    const last = this.statistics.lastCompleted;
    const summary = last ? [
      last.program?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? "—",
      last.temperature === "Cold" ? this.homey.__("statistics.cold")
        : last.temperature?.match(/\d+/)?.[0] ? last.temperature.match(/\d+/)![0] + " °C" : null,
    ].filter(Boolean).join(" · ") : this.homey.__("statistics.no_washes");
    const values: Record<string, number | string> = {
      homeconnect_washes_completed: this.statistics.totals.completed,
      homeconnect_washes_month: this.statistics.months[monthKey(new Date(), this.homey.clock.getTimezone())]?.completed ?? 0,
      homeconnect_last_wash: summary,
    };
    for (const [capability, value] of Object.entries(values)) {
      if (this.getCapabilityValue(capability) !== value) {
        await this.setCapabilityValue(capability, value as never);
      }
    }
  }

  async onUninit(): Promise<void> {
    if (this.statisticsTimer) this.homey.clearInterval(this.statisticsTimer);
    this.statisticsTimer = null;
    await super.onUninit();
    await this.statisticsPublishQueue;
  }

  async onDeleted(): Promise<void> {
    if (this.statisticsTimer) this.homey.clearInterval(this.statisticsTimer);
    this.statisticsTimer = null;
    await super.onDeleted();
    await this.statisticsPublishQueue;
  }

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

  /**
   * Right after connecting the washer reports values before it marks the
   * spin speed writable, so the first attempt is refused locally. Re-check
   * once the spin speed's access changes.
   */
  protected onDescriptionChanged(featureNames: string[]): void {
    if (!featureNames.includes(SPIN_SPEED_FEATURE)) return;
    this.lastSpinLimitWrite = null;
    this.enforceSpinLimit(this.getCapabilityValue("homeconnect_spin_speed"));
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
   * is above the limit (Auto/Max count as above), write the limit back -
   * before the start or during the program.
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
