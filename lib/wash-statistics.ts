/** Local usage history. Pure reducer: persist the returned state before publishing it. */
export const HISTORY_LIMIT = 500;
export const STATISTICS_CAPABILITIES = [
  "homeconnect_washes_completed",
  "homeconnect_washes_month",
  "homeconnect_last_wash",
] as const;

export type Outcome = "completed" | "aborted" | "unknown";
export interface WashCycle {
  startedAt: string;
  endedAt?: string;
  outcome?: Outcome;
  program: string | null;
  temperature: string | null;
  spinSpeed: string | null;
  speedPerfect: boolean | null;
  durationMinutes: number | null;
  partial: boolean;
  /** Expected appliance counter for this cycle, if the model supplies one. */
  startedCounter: number | null;
}
export interface Totals {
  completed: number;
  aborted: number;
  unknown: number;
  durationMinutes: number;
  timedCycles: number;
  programs: Record<string, number>;
  temperatures: Record<string, number>;
  spinSpeeds: Record<string, number>;
  speedPerfect: number;
}
export interface WashStatistics {
  version: 1;
  trackingSince: string;
  previousState: string | null;
  deviceCounter: number | null;
  selection: { program: string | null; temperature: string | null; spinSpeed: string | null; speedPerfect: boolean | null };
  active: WashCycle | null;
  totals: Totals;
  months: Record<string, Totals>;
  history: WashCycle[];
  lastCompleted: WashCycle | null;
}
const STATE = "BSH.Common.Status.OperationState";
const COUNTER = "BSH.Common.Status.Program.All.Count.Started";
const ACTIVE = "BSH.Common.Root.ActiveProgram";
const SELECTED = "BSH.Common.Root.SelectedProgram";
const TEMP = "LaundryCare.Washer.Option.Temperature";
const SPIN = "LaundryCare.Washer.Option.SpinSpeed";
const SPEED = "LaundryCare.Washer.Option.SpeedPerfect";
const VARIO = ["LaundryCare.Washer.Option.VarioPerfect", "LaundryCare.Common.Option.VarioPerfect"];
const RUNNING = new Set(["Run", "Pause", "ActionRequired"]);
const IDLE = new Set(["Ready", "Inactive"]);
const segment = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.split(".").pop()! : null;
const program = (v: unknown): string | null => {
  const value = segment(v);
  return value && !["0", "None", "NoProgram"].includes(value) ? value : null;
};

export function emptyTotals(): Totals {
  return { completed: 0, aborted: 0, unknown: 0, durationMinutes: 0, timedCycles: 0,
    programs: {}, temperatures: {}, spinSpeeds: {}, speedPerfect: 0 };
}
export function newStatistics(now = new Date()): WashStatistics {
  return { version: 1, trackingSince: now.toISOString(), previousState: null, deviceCounter: null,
    selection: { program: null, temperature: null, spinSpeed: null, speedPerfect: null },
    active: null, totals: emptyTotals(), months: {}, history: [], lastCompleted: null };
}
export function monthKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  return parts.find(p => p.type === "year")!.value + "-" + parts.find(p => p.type === "month")!.value;
}
function tally(totals: Totals, cycle: WashCycle): void {
  totals[cycle.outcome!]++;
  if (cycle.outcome !== "completed") return;
  for (const [key, value] of [
    ["programs", cycle.program], ["temperatures", cycle.temperature], ["spinSpeeds", cycle.spinSpeed],
  ] as const) {
    if (value) totals[key][value] = (totals[key][value] ?? 0) + 1;
  }
  if (cycle.speedPerfect) totals.speedPerfect++;
  if (cycle.durationMinutes != null) {
    totals.durationMinutes += cycle.durationMinutes;
    totals.timedCycles++;
  }
}
/**
 * Observations are complete decoded protocol batches (not capability changes).
 * A persisted active cycle survives restarts; Finished without one is ignored.
 * Missing terminal states are unverified, never assumed successful.
 */
export function observeStatistics(
  previous: WashStatistics, values: Record<string, unknown>, now: Date, timeZone: string, continuous = true,
): WashStatistics {
  const next: WashStatistics = structuredClone(previous);
  const operation = segment(values[STATE]) ?? next.previousState;
  const hasState = Object.hasOwn(values, STATE);
  const counterRaw = values[COUNTER];
  const count = counterRaw == null ? null : Number(counterRaw);
  const counter = count != null && Number.isFinite(count) && count >= 0 ? count : null;
  const counterChanged = counter != null && next.deviceCounter != null && counter !== next.deviceCounter;
  if (counter != null) next.deviceCounter = counter;
  if (Object.hasOwn(values, SELECTED)) next.selection.program = program(values[SELECTED]);
  if (Object.hasOwn(values, TEMP)) next.selection.temperature = segment(values[TEMP]);
  if (Object.hasOwn(values, SPIN)) next.selection.spinSpeed = segment(values[SPIN]);
  if (Object.hasOwn(values, SPEED)) {
    next.selection.speedPerfect = values[SPEED] === true || values[SPEED] === 1 || values[SPEED] === "true";
  }
  for (const key of VARIO) {
    if (Object.hasOwn(values, key)) next.selection.speedPerfect = segment(values[key]) === "SpeedPerfect";
  }

  const close = (outcome: Outcome): void => {
    if (!next.active) return;
    const cycle: WashCycle = { ...next.active, outcome, endedAt: now.toISOString(),
      partial: next.active.partial || !continuous,
      durationMinutes: next.active.partial || !continuous || outcome === "unknown" ? null
        : Math.max(0, Math.round((now.getTime() - Date.parse(next.active.startedAt)) / 60_000)) };
    if (outcome === "completed") next.lastCompleted = cycle;
    tally(next.totals, cycle);
    const month = monthKey(now, timeZone);
    next.months[month] ??= emptyTotals();
    tally(next.months[month], cycle);
    next.history.unshift(cycle);
    next.history.length = Math.min(next.history.length, HISTORY_LIMIT);
    next.active = null;
  };

  if (next.active && !continuous) next.active.partial = true;
  // One increment belongs to this start, even if delivered late. Only a
  // counter beyond the expected value proves that another cycle intervened.
  if (next.active && counterChanged && next.active.startedCounter != null &&
      counter! > next.active.startedCounter) close("unknown");

  if (!next.active && RUNNING.has(operation ?? "")) {
    next.active = { startedAt: now.toISOString(), ...next.selection,
      program: program(values[ACTIVE]) ?? next.selection.program,
      durationMinutes: null,
      startedCounter: counterChanged || previous.deviceCounter == null ? counter
        : previous.deviceCounter + 1,
      partial: !continuous || !hasState || !["Ready", "Inactive", "DelayedStart"].includes(previous.previousState ?? "") };
  }
  if (next.active) {
    // Options/program may arrive after the operation-state notification.
    if (RUNNING.has(operation ?? "")) {
      if (Object.hasOwn(values, ACTIVE)) next.active.program = program(values[ACTIVE]) ?? next.active.program;
      if (Object.hasOwn(values, TEMP)) next.active.temperature = next.selection.temperature;
      if (Object.hasOwn(values, SPIN)) next.active.spinSpeed = next.selection.spinSpeed;
      if (Object.hasOwn(values, SPEED) || VARIO.some(k => Object.hasOwn(values, k))) {
        next.active.speedPerfect = next.selection.speedPerfect;
      }
    }
    if (hasState && operation === "Finished") close("completed");
    else if (hasState && operation === "Aborting") close("aborted");
    else if (hasState && IDLE.has(operation ?? "")) close("unknown");
  }
  if (hasState) next.previousState = operation;
  return next;
}
export function periodTotals(stats: WashStatistics, period: string): Totals {
  if (period === "all") return stats.totals;
  const result = emptyTotals();
  for (const [month, totals] of Object.entries(stats.months)) {
    if (month !== period && !month.startsWith(period + "-")) continue;
    for (const key of ["completed", "aborted", "unknown", "durationMinutes", "timedCycles", "speedPerfect"] as const) {
      result[key] += totals[key];
    }
    for (const key of ["programs", "temperatures", "spinSpeeds"] as const) {
      for (const [name, value] of Object.entries(totals[key])) result[key][name] = (result[key][name] ?? 0) + value;
    }
  }
  return result;
}
