// Pure logic: no DOM, no storage, no network. Everything here is covered by tests/model.test.js.

export const RAIL_MODES = ['HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_RAIL', 'SUBURBAN'];
const NON_TRAIN = new Set(['WALK', 'BIKE', 'CAR', 'RENTAL', 'CAR_PARKING', 'CAR_DROPOFF', 'ODM', 'FLEX']);

export const ON_TIME_LIMIT_MIN = 5; // a run counts as on time within this many minutes
const LATE_LABEL_MIN = 2; // smaller differences are rounding noise, not a delay

const KIND = {
  HIGHSPEED_RAIL: 'High-speed',
  LONG_DISTANCE: 'Intercity',
  NIGHT_RAIL: 'Night train',
  REGIONAL_FAST_RAIL: 'Regional',
  REGIONAL_RAIL: 'Regional',
  SUBURBAN: 'Commuter',
  RAIL: 'Train',
};

export const kindLabel = (mode) => KIND[mode] || 'Train';

// Some feeds file every train under one type, so that type says nothing about the train.
export function trainKind(t) {
  return /indian railways/i.test(t.operator || '') ? 'Train' : kindLabel(t.mode);
}

/* ---------- tidying names ---------- */

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-/(.'’])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());

// Feeds shout, and some leave separators behind: "NEW DELHI,  - ", "TORONTO - UNION STATION TRAIN".
export function cleanStation(name) {
  let s = (name || '').replace(/\s+/g, ' ').replace(/[\s,\-–]+$/u, '').trim();
  if (/[A-Z]/.test(s) && !/[a-z]/.test(s)) s = titleCase(s);
  return s.replace(/ Train$/, '') || 'Unknown stop';
}

const OPERATOR_NAMES = [
  [/^oebb\b/i, 'ÖBB'],
  [/^magyar allamvasutak/i, 'MÁV'],
  [/^ceske drahy/i, 'České dráhy'],
  [/^sncf\b/i, 'SNCF'],
  [/^中国国家铁路/, 'China Railway'],
];

export function operatorName(name) {
  const raw = (name || '').trim();
  return OPERATOR_NAMES.find(([test]) => test.test(raw))?.[1] || raw;
}

/* ---------- geometry ---------- */

export function decodePolyline(encoded, precision = 6) {
  if (!encoded) return [];
  const factor = 10 ** precision;
  const points = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length + 1);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lon += delta;
    }
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

export function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cumulativeKm(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + haversineKm(points[i - 1], points[i]));
  return out;
}

function perpendicularDeg(p, a, b) {
  const dx = b[1] - a[1], dy = b[0] - a[0];
  const len = dx * dx + dy * dy;
  if (!len) return Math.hypot(p[1] - a[1], p[0] - a[0]);
  const t = Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / len));
  return Math.hypot(p[1] - (a[1] + t * dx), p[0] - (a[0] + t * dy));
}

// Ramer-Douglas-Peucker, loosened until the line fits in maxPoints.
export function simplifyLine(points, maxPoints = 240) {
  if (points.length <= maxPoints) return points;
  let tolerance = 0.0008;
  let kept = points;
  while (kept.length > maxPoints && tolerance < 5) {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [from, to] = stack.pop();
      let worst = 0, at = -1;
      for (let i = from + 1; i < to; i++) {
        const d = perpendicularDeg(points[i], points[from], points[to]);
        if (d > worst) { worst = d; at = i; }
      }
      if (worst > tolerance && at > 0) {
        keep[at] = 1;
        stack.push([from, at], [at, to]);
      }
    }
    kept = points.filter((_, i) => keep[i]);
    tolerance *= 1.7;
  }
  return kept;
}

// Kilometres along the line for each stop. Without a usable line, falls back to stop-to-stop distance.
export function stopDistances(stops, points) {
  const coords = stops.map((s) => [s.lat, s.lon]);
  const direct = cumulativeKm(coords);
  if (points.length < 2 || points.length <= stops.length) return { km: direct, approx: true };
  const along = cumulativeKm(points);
  const km = [];
  let cursor = 0;
  for (let s = 0; s < stops.length; s++) {
    let best = cursor, bestDist = Infinity;
    for (let i = cursor; i < points.length; i++) {
      const d = haversineKm(points[i], coords[s]);
      if (d < bestDist) { bestDist = d; best = i; }
      // Well past the closest approach: stop looking, so a line that doubles back keeps its order.
      if (d > bestDist + 60 && along[i] - along[best] > 60) break;
    }
    cursor = best;
    km.push(along[best]);
  }
  km[0] = 0;
  const offset = along[along.length - 1];
  if (stops.length > 1) km[km.length - 1] = Math.max(km[km.length - 2] || 0, offset);
  return { km, approx: false };
}

export function pointAlong(points, targetKm) {
  if (!points.length) return null;
  const along = cumulativeKm(points);
  if (targetKm <= 0) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (along[i] >= targetKm) {
      const span = along[i] - along[i - 1] || 1;
      const f = (targetKm - along[i - 1]) / span;
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f];
    }
  }
  return points[points.length - 1];
}

function nearestIndex(points, coord) {
  let best = 0, bestDist = Infinity;
  points.forEach((p, i) => {
    const d = haversineKm(p, coord);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/* ---------- reading the API ---------- */

const httpOnly = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '');

function toStop(place) {
  return {
    id: place.stopId || '',
    parent: place.parentId || '',
    name: cleanStation(place.name),
    lat: place.lat,
    lon: place.lon,
    tz: place.tz || '',
    schedArr: place.scheduledArrival || place.arrival || '',
    arr: place.arrival || place.scheduledArrival || '',
    schedDep: place.scheduledDeparture || place.departure || '',
    dep: place.departure || place.scheduledDeparture || '',
    track: place.track || place.scheduledTrack || '',
    schedTrack: place.scheduledTrack || '',
    cancelled: !!place.cancelled,
  };
}

function toAlerts(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const a of list || []) {
      const key = `${a.headerText}|${a.descriptionText}`;
      if (seen.has(key) || !(a.headerText || a.descriptionText)) continue;
      seen.add(key);
      out.push({ title: a.headerText || '', text: a.descriptionText || '', url: httpOnly(a.url) });
    }
  }
  return out;
}

export const isTrainLeg = (leg) => !NON_TRAIN.has(leg.mode);

export function parseTrainLeg(leg) {
  const stops = [toStop(leg.from), ...(leg.intermediateStops || []).map(toStop), toStop(leg.to)];
  stops[0].schedDep = leg.scheduledStartTime || stops[0].schedDep;
  stops[0].dep = leg.startTime || stops[0].dep;
  const last = stops[stops.length - 1];
  last.schedArr = leg.scheduledEndTime || last.schedArr;
  last.arr = leg.endTime || last.arr;

  const geometry = leg.legGeometry || {};
  const points = decodePolyline(geometry.points, geometry.precision ?? 6);
  const { km, approx } = stopDistances(stops, points);

  const number = leg.tripShortName || '';
  const line = leg.routeShortName || '';
  const category = leg.category?.shortName || leg.category?.name || '';
  return {
    tripId: leg.tripId || '',
    display: leg.displayName || '',
    number,
    line,
    lineLong: leg.routeLongName || '',
    category,
    operator: operatorName(leg.agencyName),
    operatorUrl: httpOnly(leg.agencyUrl),
    routeUrl: httpOnly(leg.routeUrl),
    mode: leg.mode,
    color: /^[0-9a-f]{6}$/i.test(leg.routeColor || '') ? leg.routeColor : '',
    headsign: leg.headsign || '',
    terminus: leg.tripTo?.name ? cleanStation(leg.tripTo.name) : stops[stops.length - 1].name,
    realTime: !!leg.realTime,
    cancelled: !!leg.cancelled,
    alerts: toAlerts(leg.alerts, leg.from?.alerts, leg.to?.alerts),
    stops,
    board: 0,
    alight: stops.length - 1,
    points: simplifyLine(points),
    km,
    kmApprox: approx,
  };
}

export function parseItinerary(it) {
  const legs = [];
  for (const leg of it.legs || []) {
    if (isTrainLeg(leg)) legs.push({ type: 'train', train: parseTrainLeg(leg) });
    else if (leg.mode === 'WALK') legs.push({ type: 'walk', minutes: Math.round((leg.duration || 0) / 60), from: leg.from?.name, to: leg.to?.name });
  }
  const trains = legs.filter((l) => l.type === 'train').map((l) => l.train);
  if (!trains.length) return null;
  const first = trains[0], last = trains[trains.length - 1];
  return {
    id: it.id || `${first.tripId}|${fromStop(first).dep}|${toStop2(last).id}`,
    legs,
    trains,
    start: fromStop(first).dep,
    end: toStop2(last).arr,
    schedStart: fromStop(first).schedDep,
    schedEnd: toStop2(last).schedArr,
    minutes: minutesBetween(fromStop(first).dep, toStop2(last).arr),
    changes: trains.length - 1,
    operators: [...new Set(trains.map((t) => t.operator).filter(Boolean))],
    cancelled: trains.some((t) => t.cancelled),
    realTime: trains.some((t) => t.realTime),
  };
}

export const fromStop = (t) => t.stops[t.board];
const toStop2 = (t) => t.stops[t.alight];
export { toStop2 as toStopOf };

const sameStop = (a, b) =>
  (a.id && (a.id === b.id || a.id === b.parent)) || (b.id && b.id === a.parent) ||
  a.name.toLowerCase() === b.name.toLowerCase() ||
  haversineKm([a.lat, a.lon], [b.lat, b.lon]) < 0.25;

// Replace the ridden section with the train's whole run, keeping where you get on and off.
export function withFullRun(train, fullLeg) {
  const full = parseTrainLeg(fullLeg);
  const from = fromStop(train), to = toStop2(train);
  const board = full.stops.findIndex((s) => sameStop(s, from));
  if (board < 0) return train;
  const offset = full.stops.slice(board + 1).findIndex((s) => sameStop(s, to));
  if (offset < 0) return train;
  return { ...train, ...full, board, alight: board + 1 + offset, alerts: full.alerts.length ? full.alerts : train.alerts };
}

// The first train leg of a /trip response that belongs to this trip.
export function tripLeg(itinerary, tripId) {
  const legs = (itinerary?.legs || []).filter(isTrainLeg);
  return legs.find((l) => l.tripId === tripId) || legs[0] || null;
}

/* ---------- names ---------- */

export function trainName(t) {
  const shown = t.display || '';
  const op = t.operator || '';
  if (/\d/.test(shown) && !/^\d+$/.test(shown)) return shown; // "RJ 258", "TGV INOUI 6641"
  const num = /^\d+$/.test(shown) ? shown : t.number;
  if (/^\d+$/.test(shown) || !shown) {
    if (num) return `${t.category || op || 'Train'} ${num}`;
    return t.line || t.lineLong || op || 'Train';
  }
  if (num && num !== shown) return `${shown} ${num}`; // "VIA Rail 62"
  if (op && op !== shown) return `${op} ${shown}`; // "Trenitalia FR"
  return t.line || shown;
}

// For a row that already names the operator: "Train 62" instead of "VIA Rail 62".
export function trainLabel(t) {
  const name = trainName(t);
  const op = t.operator || '';
  return op && name.startsWith(`${op} `) ? `Train ${name.slice(op.length + 1)}` : name;
}

// Identifies "the same train on different days".
export function serviceKey(t) {
  const op = (t.operator || 'unknown').toLowerCase().trim();
  const id = t.number || (t.display && /\d/.test(t.display) ? t.display : '');
  if (id) return `${op}|${id.toLowerCase()}`;
  return `${op}|${(t.line || t.lineLong || 'line').toLowerCase()}@${clockAt(t.stops[0].schedDep, t.stops[0].tz)}`;
}

/* ---------- time ---------- */

const zoneOf = (tz) => tz || undefined;
export const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);

export function delayMinutes(sched, actual) {
  if (!sched || !actual) return 0;
  return minutesBetween(sched, actual);
}

export function formatDuration(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const rest = m % 60;
  if (d) return `${d}d ${h}h`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function clockAt(iso, tz) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: zoneOf(tz), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function timeParts(iso, tz, hour12 = false) {
  if (!iso) return { clock: '--:--', suffix: '' };
  if (!hour12) return { clock: clockAt(iso, tz), suffix: '' };
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(tz), hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return { clock: `${get('hour')}:${get('minute')}`, suffix: get('dayPeriod').toLowerCase() };
}

export function dayKey(iso, tz) {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: zoneOf(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p.slice(0, 10);
}

export function dayLabel(iso, tz) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { timeZone: zoneOf(tz), weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}

function offsetMinutes(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utcMs);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs) / 60000;
}

// "2026-11-06" + "14:30" read as local time at a station.
export function stationTimeToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  if (!tz) return new Date(y, m - 1, d, h, min).toISOString();
  let ms = wall - offsetMinutes(wall, tz) * 60000;
  ms = wall - offsetMinutes(ms, tz) * 60000;
  return new Date(ms).toISOString();
}

export function untilLabel(targetMs, now) {
  const mins = Math.round((targetMs - now) / 60000);
  if (Math.abs(mins) < 1) return 'now';
  return mins > 0 ? `in ${formatDuration(mins)}` : `${formatDuration(-mins)} ago`;
}

/* ---------- status ---------- */

export function trainStatus(t, now = Date.now()) {
  const from = fromStop(t), to = toStop2(t);
  const dep = +new Date(from.dep), arr = +new Date(to.arr);
  const phase = now >= arr ? 'after' : now >= dep ? 'enroute' : 'before';
  const depDelay = delayMinutes(from.schedDep, from.dep);
  const arrDelay = delayMinutes(to.schedArr, to.arr);
  const delay = phase === 'before' ? depDelay : arrDelay;
  const countdown =
    phase === 'before' ? `Departs ${untilLabel(dep, now)}` :
    phase === 'enroute' ? `Arrives ${untilLabel(arr, now)}` :
    `Arrived ${untilLabel(arr, now)}`;

  if (t.cancelled || from.cancelled || to.cancelled) {
    return { code: 'cancelled', lamp: 'stop', label: 'Cancelled', sub: 'This train is not running', phase, delay: 0, live: true };
  }
  if (!t.realTime) {
    const label = phase === 'before' ? 'Scheduled' : phase === 'enroute' ? 'Under way by timetable' : 'Finished by timetable';
    const sub = phase === 'after' ? 'No live data from this operator' : countdown;
    return { code: 'scheduled', lamp: 'none', label, sub, phase, delay: 0, live: false };
  }
  if (delay >= LATE_LABEL_MIN) {
    const label = phase === 'before' ? `Delayed ${formatDuration(delay)}` : phase === 'enroute' ? `Running ${formatDuration(delay)} late` : `Arrived ${formatDuration(delay)} late`;
    return { code: 'delayed', lamp: 'caution', label, sub: countdown, phase, delay, live: true };
  }
  const label = phase === 'after' ? 'Arrived on time' : 'On time';
  return { code: 'ontime', lamp: 'go', label, sub: countdown, phase, delay, live: true };
}

// Where the train should be, from its times. Returns null before it starts and after it ends.
export function estimatePosition(t, now = Date.now()) {
  const stops = t.stops;
  const at = (s, a, b) => +new Date(s[a] || s[b]);
  const first = at(stops[0], 'dep', 'arr');
  const lastStop = stops[stops.length - 1];
  const final = at(lastStop, 'arr', 'dep');
  if (now < first || now >= final) return null;
  for (let i = 0; i < stops.length - 1; i++) {
    const arrived = i === 0 ? first : at(stops[i], 'arr', 'dep');
    const leaves = at(stops[i], 'dep', 'arr');
    const next = at(stops[i + 1], 'arr', 'dep');
    if (now >= arrived && now < leaves) return { segment: i, fraction: 0, atStop: true };
    if (now >= leaves && now < next) return { segment: i, fraction: next > leaves ? (now - leaves) / (next - leaves) : 0, atStop: false };
  }
  return null;
}

export function positionCoord(t, pos) {
  if (!pos) return null;
  const a = t.km[pos.segment], b = t.km[pos.segment + 1] ?? a;
  if (t.points.length > 1 && !t.kmApprox) return pointAlong(t.points, a + (b - a) * pos.fraction);
  const s = t.stops[pos.segment], e = t.stops[pos.segment + 1] || s;
  return [s.lat + (e.lat - s.lat) * pos.fraction, s.lon + (e.lon - s.lon) * pos.fraction];
}

// The line for only the part you ride.
export function ridePoints(t) {
  const from = fromStop(t), to = toStop2(t);
  if (t.points.length < 2) return [[from.lat, from.lon], [to.lat, to.lon]];
  const a = nearestIndex(t.points, [from.lat, from.lon]);
  const b = nearestIndex(t.points, [to.lat, to.lon]);
  return a < b ? t.points.slice(a, b + 1) : t.points;
}

/* ---------- stats ---------- */

export function tripFacts(t) {
  const from = fromStop(t), to = toStop2(t);
  const km = Math.max(0, (t.km[t.alight] ?? 0) - (t.km[t.board] ?? 0));
  const minutes = minutesBetween(from.schedDep, to.schedArr);
  return {
    km,
    approx: !!t.kmApprox,
    minutes,
    kmh: minutes > 0 ? km / (minutes / 60) : 0,
    stopsBetween: Math.max(0, t.alight - t.board - 1),
  };
}

export function onTimeSummary(runs) {
  const ran = runs.filter((r) => !r.cancelled);
  const onTime = ran.filter((r) => r.delay <= ON_TIME_LIMIT_MIN).length;
  const late = ran.filter((r) => r.delay > ON_TIME_LIMIT_MIN);
  return {
    total: runs.length,
    cancelled: runs.length - ran.length,
    onTime,
    percent: ran.length ? Math.round((onTime / ran.length) * 100) : null,
    averageLate: late.length ? Math.round(late.reduce((n, r) => n + r.delay, 0) / late.length) : 0,
    worst: ran.reduce((m, r) => Math.max(m, r.delay), 0),
  };
}

export function transferMinutes(prev, next) {
  return minutesBetween(toStop2(prev).arr, fromStop(next).dep);
}

// How comfortable a change of trains is, from the time between them.
export function transferRating(minutes) {
  if (minutes < 0) return { code: 'missed', label: 'Connection missed' };
  if (minutes < 8) return { code: 'tight', label: 'Tight connection' };
  if (minutes < 20) return { code: 'ok', label: 'Fair connection' };
  return { code: 'easy', label: 'Plenty of time' };
}

export const isRide = (trip, now = Date.now()) => {
  const end = trip.train ? toStop2(trip.train).arr : trip.end;
  return !trip.train.cancelled && +new Date(end) <= now;
};

export function rideYears(trips, now = Date.now()) {
  const years = new Set(trips.filter((t) => isRide(t, now)).map((t) => dayKey(fromStop(t.train).schedDep, fromStop(t.train).tz).slice(0, 4)));
  return [...years].sort().reverse();
}

export function passportStats(trips, year = null, now = Date.now()) {
  const rides = trips
    .filter((t) => isRide(t, now))
    .filter((t) => !year || dayKey(fromStop(t.train).schedDep, fromStop(t.train).tz).startsWith(year))
    .sort((a, b) => new Date(fromStop(a.train).schedDep) - new Date(fromStop(b.train).schedDep));

  const operators = new Map();
  const stations = new Map();
  const countries = new Set();
  const months = Array(12).fill(0);
  let km = 0, minutes = 0, night = 0, liveRides = 0, onTime = 0, lateMinutes = 0;
  let anyApprox = false, longest = null, fastest = null;

  for (const trip of rides) {
    const t = trip.train;
    const from = fromStop(t), to = toStop2(t);
    const facts = tripFacts(t);
    km += facts.km;
    anyApprox = anyApprox || facts.approx;
    minutes += Math.max(0, minutesBetween(from.dep, to.arr));
    if (t.mode === 'NIGHT_RAIL') night += 1;
    if (t.operator) operators.set(t.operator, (operators.get(t.operator) || 0) + 1);
    for (const s of [from, to]) {
      const k = s.id || s.name;
      stations.set(k, { name: s.name, count: (stations.get(k)?.count || 0) + 1 });
    }
    for (const c of [trip.countries?.from, trip.countries?.to]) if (c) countries.add(c);
    const month = +dayKey(from.schedDep, from.tz).slice(5, 7) - 1;
    if (month >= 0) months[month] += facts.km;
    if (!longest || facts.km > longest.km) longest = { km: facts.km, trip };
    if (facts.km >= 20 && (!fastest || facts.kmh > fastest.kmh)) fastest = { kmh: facts.kmh, trip };
    if (t.realTime) {
      liveRides += 1;
      const d = delayMinutes(to.schedArr, to.arr);
      if (d <= ON_TIME_LIMIT_MIN) onTime += 1;
      lateMinutes += Math.max(0, d);
    }
  }
  const byCount = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    rides, km, minutes, night, anyApprox, longest, fastest, months,
    operatorCount: operators.size,
    topOperator: byCount(operators)[0] || null,
    stationCount: stations.size,
    topStation: [...stations.values()].sort((a, b) => b.count - a.count)[0] || null,
    countryCount: countries.size,
    liveRides, onTime, lateMinutes,
    onTimePercent: liveRides ? Math.round((onTime / liveRides) * 100) : null,
  };
}

// Distances to measure a lifetime of riding against. Unnamed ones are round numbers.
export const LIFETIME_MILEPOSTS = [
  { km: 1000 },
  { km: 4466, goal: 'match The Canadian, Toronto to Vancouver', done: 'farther than The Canadian, Toronto to Vancouver' },
  { km: 9289, goal: 'match the Trans-Siberian, Moscow to Vladivostok', done: 'farther than the Trans-Siberian, Moscow to Vladivostok' },
  { km: 20000 },
  { km: 40075, goal: 'go once around the Earth', done: 'farther than once around the Earth' },
  { km: 100000 },
  { km: 384400, goal: 'reach the Moon', done: 'farther than the distance to the Moon' },
];

export function nextMilepost(km) {
  const next = LIFETIME_MILEPOSTS.find((m) => m.km > km) || null;
  const passed = [...LIFETIME_MILEPOSTS].reverse().find((m) => m.km <= km) || null;
  return { next, passed };
}

// A route logged by hand has no line, so its length is estimated from the straight-line distance.
export const ROAD_FACTOR = 1.15;

export function manualTrain({ from, to, departIso, arriveIso, operator, name, mode }) {
  const straight = haversineKm([from.lat, from.lon], [to.lat, to.lon]);
  const stop = (s, iso) => ({
    id: s.id, parent: '', name: s.name, lat: s.lat, lon: s.lon, tz: s.tz || '',
    schedArr: iso, arr: iso, schedDep: iso, dep: iso, track: '', schedTrack: '', cancelled: false,
  });
  return {
    tripId: '', display: name || '', number: '', line: '', lineLong: '', category: '',
    operator: operator || '', operatorUrl: '', routeUrl: '', mode: mode || 'LONG_DISTANCE', color: '',
    headsign: to.name, terminus: to.name, realTime: false, cancelled: false, alerts: [],
    stops: [stop(from, departIso), stop(to, arriveIso)],
    board: 0, alight: 1,
    points: [[from.lat, from.lon], [to.lat, to.lon]],
    km: [0, straight * ROAD_FACTOR],
    kmApprox: true,
  };
}

export const kmToMiles = (km) => km * 0.621371;

export function flag(cc) {
  if (!/^[a-z]{2}$/i.test(cc || '')) return '';
  return [...cc.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}
