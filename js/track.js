// Keeps saved trains current and builds on-time history. There is no server, so this only runs
// while the app is open, and only records what the operator actually published.
import { fetchArrivals, fetchRun } from './api.js';
import {
  clockAt, dayKey, delayMinutes, fromStop, minutesBetween, operatorName, serviceKey, stationTimeToUtc, toStopOf, withFullRun,
} from './model.js';
import { getState, logRun, markWatchChecked, runsFor, updateTrip } from './store.js';

const HOUR = 3600000;
const WATCH_INTERVAL = HOUR / 2;
const MAX_RUN_AGE = 18 * HOUR;
const MAX_WATCH_CHECKS = 12;

// A finished run with live data becomes one line of history.
export function recordIfFinished(train, now = Date.now()) {
  if (!train.realTime) return;
  const last = train.stops[train.stops.length - 1];
  if (+new Date(last.arr) > now && !train.cancelled) return;
  logRun(serviceKey(train), {
    date: dayKey(train.stops[0].schedDep, train.stops[0].tz),
    delay: train.cancelled ? 0 : Math.max(0, delayMinutes(last.schedArr, last.arr)),
    cancelled: !!train.cancelled,
    stop: last.name,
  });
}

const needsRefresh = (trip, now) => {
  const t = trip.train;
  if (trip.manual || !t.tripId || trip.settled) return false;
  const dep = +new Date(fromStop(t).dep), arr = +new Date(toStopOf(t).arr);
  return now > dep - 12 * HOUR && now < arr + 48 * HOUR;
};

export async function refreshSavedTrains(now = Date.now()) {
  for (const trip of getState().trips.filter((t) => needsRefresh(t, now))) {
    try {
      const leg = await fetchRun(trip.train.tripId);
      if (!leg) continue;
      const train = withFullRun(trip.train, leg);
      const arr = +new Date(toStopOf(train).arr);
      updateTrip(trip.id, { train, settled: now > arr + 2 * HOUR });
      recordIfFinished(train, now);
    } catch { /* keep the last known times */ }
  }
}

const sameService = (watch, stopTime) =>
  operatorName(stopTime.agencyName) === (watch.operator || '') &&
  (watch.number ? stopTime.tripShortName === watch.number : stopTime.displayName === watch.display || stopTime.routeShortName === watch.line);

// The data service keeps live times for finished trains only for a limited time, so a run has
// to be logged soon after it ends. A run with no live data is skipped, never counted as on time.
async function checkWatch(watch, now) {
  const clock = clockAt(watch.arrIso, watch.tz);
  const today = dayKey(new Date(now).toISOString(), watch.tz);
  const yesterday = dayKey(new Date(now - 24 * HOUR).toISOString(), watch.tz);
  for (const day of [yesterday, today]) {
    if (runsFor(watch.key).some((r) => r.date === day)) continue;
    const expected = +new Date(stationTimeToUtc(day, clock, watch.tz));
    if (expected > now || now - expected > MAX_RUN_AGE) continue;
    const time = new Date(expected + 3 * HOUR).toISOString();
    const arrivals = await fetchArrivals({ stopId: watch.stopId, time, windowSeconds: 6 * 3600 });
    const hit = arrivals.find((a) => sameService(watch, a) && Math.abs(minutesBetween(new Date(expected).toISOString(), a.place.scheduledArrival || a.place.arrival)) < 90);
    if (!hit || !hit.realTime) continue;
    const gone = !!(hit.tripCancelled || hit.cancelled);
    if (!gone && +new Date(hit.place.arrival) > now) continue;
    logRun(watch.key, {
      date: day,
      delay: gone ? 0 : Math.max(0, delayMinutes(hit.place.scheduledArrival, hit.place.arrival)),
      cancelled: gone,
      stop: watch.stopName,
    });
  }
}

export async function checkWatchedTrains(now = Date.now()) {
  const due = getState().watches
    .filter((w) => !w.lastChecked || now - +new Date(w.lastChecked) > WATCH_INTERVAL)
    .slice(0, MAX_WATCH_CHECKS);
  for (const watch of due) {
    try {
      await checkWatch(watch, now);
      markWatchChecked(watch.key);
    } catch { /* try again next time the app opens */ }
  }
}

let running = false;

export async function catchUp() {
  if (running || navigator.onLine === false) return;
  running = true;
  try {
    await refreshSavedTrains();
    await checkWatchedTrains();
  } finally {
    running = false;
  }
}
