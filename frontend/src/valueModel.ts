// Money-based effort estimate model. Configurable and persisted in localStorage
// so the assumptions (human coding pace and hourly rate) can be defined by the
// user. effort_hours = lines / linesPerHour ; money = effort_hours * ratePerHour.

export interface ValueModel {
  linesPerHour: number; // human implementation pace (lines / hour)
  ratePerHour: number;  // hourly rate in `currency`
  currency: string;
}

export const DEFAULT_MODEL: ValueModel = {
  linesPerHour: 30,
  ratePerHour: 6000,
  currency: "¥",
};

const KEY = "cch.valueModel";

export function loadModel(): ValueModel {
  try {
    return { ...DEFAULT_MODEL, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULT_MODEL;
  }
}

export function saveModel(m: ValueModel): void {
  localStorage.setItem(KEY, JSON.stringify(m));
}

export function estimate(lines: number, m: ValueModel): { hours: number; money: number } {
  const hours = m.linesPerHour > 0 ? lines / m.linesPerHour : 0;
  return { hours, money: hours * m.ratePerHour };
}

export function fmtMoney(n: number, currency: string): string {
  return currency + Math.round(n).toLocaleString();
}
