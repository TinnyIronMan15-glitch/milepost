// Everything the person saves lives on their own phone, in this one record.
import { useEffect, useState } from '../vendor/preact-htm.js';
import { fromStop, serviceKey, simplifyLine, toStopOf } from './model.js';

const KEY = 'milepost.v1';
const MAX_RUNS = 120;
const MAX_RECENT = 8;

const empty = () => ({
  v: 1,
  trips: [],      // saved trains: { id, addedAt, manual, countries, train }
  watches: [],    // trains logged for on-time history: { key, name, operator, stopId, stopName, tz, clock, match, lastChecked }
  runs: {},       // serviceKey -> [{ date, delay, cancelled, stop }]
  recents: [],    // stations picked recently
  prefs: { hour12: defaultHour12(), units: 'km', installDismissed: false },
});

function defaultHour12() {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
  } catch {
    return false;
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.v === 1) {
      const base = empty();
      return { ...base, ...saved, prefs: { ...base.prefs, ...saved.prefs } };
    }
  } catch { /* unreadable: start fresh */ }
  return empty();
}

let state = load();
const listeners = new Set();
let storageFailed = false;

function commit(next) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  listeners.forEach((fn) => fn(state));
}

export const getState = () => state;
export const saveFailed = () => storageFailed;

export function useStore() {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    return () => listeners.delete(setValue);
  }, []);
  return value;
}

export function setPrefs(patch) {
  commit({ ...state, prefs: { ...state.prefs, ...patch } });
}

/* Stations */

export function rememberStation(station) {
  const recents = [station, ...state.recents.filter((s) => s.id !== station.id)].slice(0, MAX_RECENT);
  commit({ ...state, recents });
}

/* Saved trains */

const tripIdOf = (t) => `${t.tripId || 'manual'}|${fromStop(t).id}|${fromStop(t).schedDep}`;

function storable(train) {
  return { ...train, points: simplifyLine(train.points, 200) };
}

export const findTrip = (train) => state.trips.find((t) => t.id === tripIdOf(train));
export const tripById = (id) => state.trips.find((t) => t.id === id);

export function addTrip(train, { manual = false, countries = {} } = {}) {
  const id = tripIdOf(train);
  if (state.trips.some((t) => t.id === id)) return id;
  const trip = { id, addedAt: new Date().toISOString(), manual, countries, train: storable(train) };
  commit({ ...state, trips: [...state.trips, trip] });
  return id;
}

export function updateTrip(id, patch) {
  commit({
    ...state,
    trips: state.trips.map((t) => (t.id === id ? { ...t, ...patch, train: patch.train ? storable(patch.train) : t.train } : t)),
  });
}

export function removeTrip(id) {
  commit({ ...state, trips: state.trips.filter((t) => t.id !== id) });
}

/* On-time history */

export const runsFor = (key) => state.runs[key] || [];

export function logRun(key, run) {
  const existing = state.runs[key] || [];
  const others = existing.filter((r) => r.date !== run.date);
  const runs = [...others, run].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_RUNS);
  if (JSON.stringify(runs) === JSON.stringify(existing)) return;
  commit({ ...state, runs: { ...state.runs, [key]: runs } });
}

export const isWatched = (train) => state.watches.some((w) => w.key === serviceKey(train));

export function toggleWatch(train) {
  const key = serviceKey(train);
  if (state.watches.some((w) => w.key === key)) {
    commit({ ...state, watches: state.watches.filter((w) => w.key !== key) });
    return false;
  }
  const end = train.stops[train.stops.length - 1];
  const watch = {
    key,
    name: train.display || train.number || train.line || 'Train',
    fullName: '',
    operator: train.operator,
    number: train.number,
    display: train.display,
    line: train.line,
    stopId: end.id,
    stopName: end.name,
    tz: end.tz,
    arrIso: end.schedArr,
    lastChecked: '',
  };
  commit({ ...state, watches: [...state.watches, watch] });
  return true;
}

export function markWatchChecked(key) {
  commit({ ...state, watches: state.watches.map((w) => (w.key === key ? { ...w, lastChecked: new Date().toISOString() } : w)) });
}

/* Backup */

export const exportBackup = () => JSON.stringify(state, null, 1);

export function importBackup(text) {
  const data = JSON.parse(text);
  if (data?.v !== 1 || !Array.isArray(data.trips)) throw new Error('This is not a Milepost backup file.');
  const valid = (t) => t?.id && Array.isArray(t.train?.stops) && t.train.stops.length >= 2;
  const trips = data.trips.filter(valid);
  const ids = new Set(state.trips.map((t) => t.id));
  commit({
    ...state,
    trips: [...state.trips, ...trips.filter((t) => !ids.has(t.id))],
    runs: { ...data.runs, ...state.runs },
  });
  return trips.length;
}

export const lastStop = (t) => toStopOf(t);
