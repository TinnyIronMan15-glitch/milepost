import { API_BASE, DAILY_SEARCH_LIMIT } from './config.js';
import { RAIL_MODES, parseItinerary, parseTrainLeg, tripLeg } from './model.js';

const MODES = RAIL_MODES.join(',');
const LANGUAGE = 'en';

export class ApiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const MESSAGES = {
  offline: 'You appear to be offline. Connect to the internet and try again.',
  busy: 'The train data service is busy. Wait a minute and try again.',
  server: 'The train data service had a problem. Try again in a few minutes.',
  limit: `You have reached today's limit of ${DAILY_SEARCH_LIMIT} searches. It resets tomorrow.`,
  missing: 'This train is no longer in the timetable data.',
};

const memory = new Map();

function fromCache(key) {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  memory.delete(key);
  return null;
}

function toCache(key, value, ttlSeconds) {
  if (memory.size > 80) memory.delete(memory.keys().next().value);
  memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

async function get(path, params, { signal, ttl = 0 } = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') query.set(k, v);
  const url = `${API_BASE}${path}?${query}`;
  if (ttl) {
    const cached = fromCache(url);
    if (cached) return cached;
  }
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(navigator.onLine === false ? 'offline' : 'server', navigator.onLine === false ? MESSAGES.offline : MESSAGES.server);
  }
  if (res.status === 429) throw new ApiError('busy', MESSAGES.busy);
  if (res.status === 404) throw new ApiError('missing', MESSAGES.missing);
  if (!res.ok) throw new ApiError('server', MESSAGES.server);
  const data = await res.json();
  if (ttl) toCache(url, data, ttl);
  return data;
}

/* Search counting. Journey searches are the expensive request for the data service. */

const countKey = 'milepost.searches';

function countSearch() {
  const today = new Date().toISOString().slice(0, 10);
  let record = { day: today, n: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(countKey) || 'null');
    if (saved?.day === today) record = saved;
  } catch { /* private mode: no count kept */ }
  if (record.n >= DAILY_SEARCH_LIMIT) throw new ApiError('limit', MESSAGES.limit);
  record.n += 1;
  try { localStorage.setItem(countKey, JSON.stringify(record)); } catch { /* ignore */ }
}

/* Requests */

export async function searchStations(text, signal) {
  const matches = await get('/v1/geocode', { text, type: 'STOP', mode: MODES, numResults: 10, language: LANGUAGE }, { signal, ttl: 3600 });
  return matches.filter((m) => m.type === 'STOP').map((m) => ({
    id: m.id,
    name: m.name,
    lat: m.lat,
    lon: m.lon,
    tz: m.tz || '',
    country: m.country || '',
    area: (m.areas || []).find((a) => a.default)?.name || m.areas?.[0]?.name || '',
  }));
}

export async function planJourneys({ from, to, time, cursor }, signal) {
  const params = {
    fromPlace: from,
    toPlace: to,
    time,
    transitModes: MODES,
    numItineraries: 8,
    pageCursor: cursor,
    language: LANGUAGE,
    detailedTransfers: false,
  };
  const key = `plan|${JSON.stringify(params)}`;
  const cached = fromCache(key);
  if (cached) return cached;
  countSearch();
  const data = await get('/v6/plan', params, { signal });
  const result = {
    from: data.from,
    to: data.to,
    itineraries: (data.itineraries || []).map(parseItinerary).filter(Boolean),
    next: data.nextPageCursor || '',
    previous: data.previousPageCursor || '',
  };
  toCache(key, result, 120);
  return result;
}

// One train's full run with its latest times. Far lighter on the service than a journey search.
export async function fetchRun(tripId, signal) {
  const data = await get('/v6/trip', { tripId, language: LANGUAGE }, { signal, ttl: 45 });
  return tripLeg(data, tripId);
}

export async function fetchRunAsTrain(tripId, signal) {
  const leg = await fetchRun(tripId, signal);
  if (!leg) throw new ApiError('missing', MESSAGES.missing);
  return parseTrainLeg(leg);
}

// Arrivals at a station around a time. Used to record how a watched train ran.
export async function fetchArrivals({ stopId, time, windowSeconds }, signal) {
  const data = await get('/v6/stoptimes', {
    stopId, time, arriveBy: true, window: windowSeconds, n: 60, mode: MODES, language: LANGUAGE, withAlerts: false,
  }, { signal, ttl: 300 });
  return data.stopTimes || [];
}

export async function countryAt(lat, lon, signal) {
  try {
    const hits = await get('/v1/reverse-geocode', { place: `${lat},${lon}` }, { signal, ttl: 86400 });
    return hits.find((h) => h.country)?.country || '';
  } catch {
    return '';
  }
}
