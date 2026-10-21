import { round } from './util.js';

// The waste meter measures how much of observed session time was idle
// (no input, or the tab hidden). Below MIN_SECONDS there is too little
// data to judge, so the level stays "ok".
export const WATCH_SHARE = 0.15;
export const ALERT_SHARE = 0.3;
export const MIN_SECONDS = 60;

export function levelFor(totalSeconds, wasteShare) {
  if (totalSeconds < MIN_SECONDS) return 'ok';
  if (wasteShare >= ALERT_SHARE) return 'alert';
  if (wasteShare >= WATCH_SHARE) return 'watch';
  return 'ok';
}

export function wasteReport(beats) {
  let active = 0;
  let idle = 0;
  for (const beat of beats) {
    active += beat.active;
    idle += beat.idle;
  }
  const total = active + idle;
  const wastePct = total > 0 ? idle / total : 0;
  return {
    activeSeconds: round(active, 0),
    idleSeconds: round(idle, 0),
    totalSeconds: round(total, 0),
    wastePct: round(wastePct, 3),
    level: levelFor(total, wastePct),
  };
}
