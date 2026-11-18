import { type Metric, onCLS, onFCP, onLCP, onTTFB } from "web-vitals";
import type { Rating, VitalName } from "./timing";

/**
 * The page load's Web Vitals, from Google's web-vitals library: LCP, CLS,
 * FCP, and TTFB. The library reads buffered entries, so it reports the load
 * however late the toolbar starts it, and with every change reported, the
 * panel shows LCP and CLS as they grow rather than when the page is hidden.
 * INP is left to the timing state, which counts only the application's
 * interactions.
 */

interface Vital {
  readonly name: Exclude<VitalName, "INP">;
  readonly value: number;
  readonly rating: Rating;
}

export type Vitals = Readonly<Partial<Record<Vital["name"], Vital>>>;

let vitals: Vitals = {};
let started = false;
const listeners = new Set<() => void>();

function report(metric: Metric) {
  const name = metric.name as Vital["name"];
  vitals = { ...vitals, [name]: { name, value: metric.value, rating: metric.rating } };
  for (const listener of listeners) listener();
}

export function subscribeVitals(listener: () => void): () => void {
  if (!started) {
    started = true;
    const options = { reportAllChanges: true };
    onLCP(report, options);
    onCLS(report, options);
    onFCP(report, options);
    onTTFB(report, options);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getVitals = (): Vitals => vitals;

const NONE: Vitals = {};
export const getServerVitals = (): Vitals => NONE;
