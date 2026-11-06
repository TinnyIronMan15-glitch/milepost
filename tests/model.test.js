import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePolyline, haversineKm, simplifyLine, stopDistances, parseItinerary, parseTrainLeg, trainStatus, withFullRun,
  fromStop, toStopOf, estimatePosition, positionCoord, formatDuration, stationTimeToUtc, tripFacts, onTimeSummary,
  passportStats, serviceKey, trainName, transferRating, clockAt, timeParts, nextMilepost, manualTrain, flag, ridePoints,
} from '../js/model.js';
import { serviceInfo } from '../js/services.js';

// Google's documented polyline example, at precision 5.
test('decodes a polyline', () => {
  const p = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(p, [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('distance between Toronto and Montreal is about right', () => {
  const km = haversineKm([43.6453, -79.3806], [45.4995, -73.5665]);
  assert.ok(km > 495 && km < 510, String(km));
});

test('simplifying keeps the ends and respects the limit', () => {
  const line = Array.from({ length: 3000 }, (_, i) => [45 + i * 0.001, -75 + Math.sin(i / 40) * 0.2]);
  const s = simplifyLine(line, 200);
  assert.ok(s.length <= 200);
  assert.deepEqual(s[0], line[0]);
  assert.deepEqual(s[s.length - 1], line[line.length - 1]);
});

const place = (name, lat, lon, extra = {}) => ({ name, stopId: name.toLowerCase(), lat, lon, tz: 'America/Toronto', ...extra });

function encode(points, precision = 6) {
  const f = 10 ** precision;
  let out = '', pa = 0, po = 0;
  const num = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = '';
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const [a, o] of points) {
    const ia = Math.round(a * f), io = Math.round(o * f);
    out += num(ia - pa) + num(io - po);
    pa = ia; po = io;
  }
  return out;
}

const line = Array.from({ length: 20 }, (_, i) => [44.25 - i * 0.03, -76.5 - i * 0.15]);

const leg = (over = {}) => ({
  mode: 'LONG_DISTANCE', tripId: 'trip-1', tripShortName: '65', routeShortName: 'Corridor', displayName: '', agencyName: 'VIA Rail',
  agencyUrl: 'https://www.viarail.ca', headsign: 'Toronto', realTime: true, cancelled: false,
  startTime: '2026-11-06T19:40:00Z', scheduledStartTime: '2026-11-06T19:30:00Z',
  endTime: '2026-11-06T22:10:00Z', scheduledEndTime: '2026-11-06T22:00:00Z', duration: 9000,
  from: place('Kingston', 44.25, -76.5),
  to: place('Toronto', line[19][0], line[19][1]),
  intermediateStops: [place('Belleville', line[8][0], line[8][1], { scheduledArrival: '2026-11-06T20:30:00Z', arrival: '2026-11-06T20:38:00Z', scheduledDeparture: '2026-11-06T20:32:00Z', departure: '2026-11-06T20:40:00Z' })],
  legGeometry: { points: encode([...line]), precision: 6, length: line.length },
  ...over,
});

test('reads a train leg with times, operator and stops', () => {
  const t = parseTrainLeg(leg());
  assert.equal(t.operator, 'VIA Rail');
  assert.equal(t.stops.length, 3);
  assert.equal(fromStop(t).schedDep, '2026-11-06T19:30:00Z');
  assert.equal(toStopOf(t).arr, '2026-11-06T22:10:00Z');
  assert.equal(trainName(t), 'VIA Rail 65');
  const facts = tripFacts(t);
  assert.equal(facts.minutes, 150);
  assert.equal(facts.stopsBetween, 1);
  assert.ok(facts.km > 110 && facts.km < 260, String(facts.km));
  assert.equal(facts.approx, false);
});

test('stop distances increase along the line', () => {
  const t = parseTrainLeg(leg());
  assert.ok(t.km[0] === 0 && t.km[1] > 0 && t.km[2] > t.km[1]);
});

test('without a real line, distances are flagged as approximate', () => {
  const t = parseTrainLeg(leg({ legGeometry: { points: '', precision: 6, length: 0 } }));
  assert.equal(t.kmApprox, true);
  assert.ok(t.km[2] > 0);
});

test('a non-https operator link is dropped', () => {
  assert.equal(parseTrainLeg(leg({ agencyUrl: 'javascript:alert(1)' })).operatorUrl, '');
});

test('status: before, delayed', () => {
  const s = trainStatus(parseTrainLeg(leg()), Date.parse('2026-11-06T18:00:00Z'));
  assert.equal(s.code, 'delayed');
  assert.equal(s.label, 'Delayed 10m');
  assert.equal(s.phase, 'before');
  assert.equal(s.lamp, 'caution');
});

test('status: live and on time', () => {
  const s = trainStatus(parseTrainLeg(leg({ startTime: '2026-11-06T19:30:00Z', endTime: '2026-11-06T22:00:00Z' })), Date.parse('2026-11-06T18:00:00Z'));
  assert.equal(s.code, 'ontime');
});

test('status: no live data never claims on time', () => {
  const s = trainStatus(parseTrainLeg(leg({ realTime: false, startTime: '2026-11-06T19:30:00Z', endTime: '2026-11-06T22:00:00Z' })), Date.parse('2026-11-06T20:00:00Z'));
  assert.equal(s.code, 'scheduled');
  assert.equal(s.live, false);
  assert.match(s.label, /timetable/);
});

test('status: cancelled wins', () => {
  assert.equal(trainStatus(parseTrainLeg(leg({ cancelled: true })), Date.parse('2026-11-06T20:00:00Z')).code, 'cancelled');
});

test('status: arrived late', () => {
  const s = trainStatus(parseTrainLeg(leg()), Date.parse('2026-11-07T01:00:00Z'));
  assert.equal(s.label, 'Arrived 10m late');
  assert.equal(s.phase, 'after');
});

test('position: moving between stops, stopped at a stop, and off the line', () => {
  const t = parseTrainLeg(leg());
  assert.equal(estimatePosition(t, Date.parse('2026-11-06T19:00:00Z')), null);
  const moving = estimatePosition(t, Date.parse('2026-11-06T20:09:00Z'));
  assert.equal(moving.segment, 0);
  assert.ok(Math.abs(moving.fraction - 29 / 58) < 0.01, String(moving.fraction));
  assert.ok(positionCoord(t, moving));
  const stopped = estimatePosition(t, Date.parse('2026-11-06T20:39:00Z'));
  assert.equal(stopped.atStop, true);
  assert.equal(stopped.segment, 1);
  assert.equal(estimatePosition(t, Date.parse('2026-11-07T01:00:00Z')), null);
});

test('full run keeps where you board and alight', () => {
  const ride = parseTrainLeg(leg());
  const whole = leg({
    from: place('Ottawa', 45.4, -75.6, { scheduledDeparture: '2026-11-06T17:30:00Z', departure: '2026-11-06T17:30:00Z' }),
    scheduledStartTime: '2026-11-06T17:30:00Z', startTime: '2026-11-06T17:30:00Z',
    intermediateStops: [
      place('Kingston', 44.25, -76.5, { scheduledArrival: '2026-11-06T19:28:00Z', arrival: '2026-11-06T19:38:00Z', scheduledDeparture: '2026-11-06T19:30:00Z', departure: '2026-11-06T19:40:00Z' }),
      place('Belleville', line[8][0], line[8][1]),
    ],
    legGeometry: { points: encode([[45.4, -75.6], ...line]), precision: 6, length: line.length + 1 },
  });
  const merged = withFullRun(ride, whole);
  assert.equal(merged.stops.length, 4);
  assert.equal(merged.board, 1);
  assert.equal(merged.alight, 3);
  assert.equal(fromStop(merged).name, 'Kingston');
  assert.ok(ridePoints(merged).length <= merged.points.length);
  const facts = tripFacts(merged);
  assert.ok(facts.km > 100, String(facts.km));
  assert.equal(facts.stopsBetween, 1);
});

test('itinerary with a change', () => {
  const it = parseItinerary({
    id: 'a', duration: 100, startTime: '', endTime: '', transfers: 1,
    legs: [
      leg(),
      { mode: 'WALK', duration: 300, from: place('Toronto', 43, -79), to: place('Toronto', 43, -79) },
      leg({ agencyName: 'GO Transit', tripId: 'trip-2', tripShortName: '900', startTime: '2026-11-06T22:30:00Z', scheduledStartTime: '2026-11-06T22:30:00Z', endTime: '2026-11-06T23:30:00Z', scheduledEndTime: '2026-11-06T23:30:00Z' }),
    ],
  });
  assert.equal(it.changes, 1);
  assert.deepEqual(it.operators, ['VIA Rail', 'GO Transit']);
  assert.equal(it.legs.length, 3);
  assert.equal(it.minutes, 230);
});

test('an itinerary with no trains is dropped', () => {
  assert.equal(parseItinerary({ legs: [{ mode: 'WALK', from: {}, to: {} }] }), null);
});

test('formats durations', () => {
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(153), '2h 33m');
  assert.equal(formatDuration(1500), '1d 1h');
});

test('station time converts across time zones and daylight changes', () => {
  assert.equal(stationTimeToUtc('2026-11-06', '14:30', 'America/Toronto'), '2026-11-06T19:30:00.000Z');
  assert.equal(stationTimeToUtc('2026-07-06', '14:30', 'America/Toronto'), '2026-07-06T18:30:00.000Z');
  assert.equal(stationTimeToUtc('2026-11-06', '09:00', 'Asia/Tokyo'), '2026-11-06T00:00:00.000Z');
  assert.equal(stationTimeToUtc('2026-11-06', '09:00', 'Asia/Kolkata'), '2026-11-06T03:30:00.000Z');
});

test('clock shows the station time, not the phone time', () => {
  assert.equal(clockAt('2026-11-06T19:30:00Z', 'America/Toronto'), '14:30');
  assert.equal(clockAt('2026-11-06T19:30:00Z', 'Europe/Vienna'), '20:30');
  assert.deepEqual(timeParts('2026-11-06T19:30:00Z', 'America/Toronto', true), { clock: '2:30', suffix: 'pm' });
});

test('on-time summary ignores cancelled runs in the percentage', () => {
  const s = onTimeSummary([{ delay: 0 }, { delay: 4 }, { delay: 20 }, { delay: 0, cancelled: true }]);
  assert.equal(s.total, 4);
  assert.equal(s.cancelled, 1);
  assert.equal(s.percent, 67);
  assert.equal(s.averageLate, 20);
  assert.equal(s.worst, 20);
  assert.equal(onTimeSummary([]).percent, null);
});

test('service key is stable across days', () => {
  const a = parseTrainLeg(leg());
  const b = parseTrainLeg(leg({ tripId: 'other', startTime: '2026-11-07T19:30:00Z', endTime: '2026-11-07T22:00:00Z' }));
  assert.equal(serviceKey(a), serviceKey(b));
});

test('connection rating', () => {
  assert.equal(transferRating(-1).code, 'missed');
  assert.equal(transferRating(5).code, 'tight');
  assert.equal(transferRating(12).code, 'ok');
  assert.equal(transferRating(40).code, 'easy');
});

test('passport adds up finished rides only', () => {
  const done = { id: '1', train: parseTrainLeg(leg()), countries: { from: 'CA', to: 'CA' } };
  const future = { id: '2', train: parseTrainLeg(leg({ startTime: '2030-01-01T10:00:00Z', scheduledStartTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T12:00:00Z', scheduledEndTime: '2030-01-01T12:00:00Z' })) };
  const cancelled = { id: '3', train: parseTrainLeg(leg({ cancelled: true })) };
  const s = passportStats([done, future, cancelled], null, Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(s.rides.length, 1);
  assert.equal(s.countryCount, 1);
  assert.equal(s.operatorCount, 1);
  assert.equal(s.stationCount, 2);
  assert.equal(s.minutes, 150);
  assert.equal(s.liveRides, 1);
  assert.equal(s.onTimePercent, 0);
  assert.equal(s.lateMinutes, 10);
  assert.ok(s.months[10] > 0);
  assert.equal(passportStats([done], '2025', Date.parse('2027-01-01T00:00:00Z')).rides.length, 0);
});

test('milepost progress', () => {
  assert.equal(nextMilepost(0).next.km, 1000);
  assert.equal(nextMilepost(5000).next.km, 9289);
  assert.equal(nextMilepost(5000).passed.km, 4466);
});

test('a logged trip estimates its length and is marked approximate', () => {
  const t = manualTrain({
    from: { id: 'a', name: 'Budapest', lat: 47.5, lon: 19.08 }, to: { id: 'b', name: 'Vienna', lat: 48.18, lon: 16.37 },
    departIso: '2026-05-01T09:00:00Z', arriveIso: '2026-05-01T11:40:00Z', operator: 'MÁV',
  });
  const f = tripFacts(t);
  assert.equal(f.approx, true);
  assert.equal(f.minutes, 160);
  assert.ok(f.km > 230 && f.km < 280, String(f.km));
});

test('flags', () => {
  assert.equal(flag('ca'), '🇨🇦');
  assert.equal(flag(''), '');
  assert.equal(flag('<x'), '');
});

test('service facts', () => {
  assert.equal(serviceInfo({ display: 'ICE 123', operator: 'DB Fernverkehr' }).name, 'ICE');
  assert.equal(serviceInfo({ display: 'Nozomi 5', operator: 'JR Central', stops: [{ tz: 'Asia/Tokyo' }] }).name, 'Shinkansen');
  assert.equal(serviceInfo({ number: 'G1', operator: 'China Railway', stops: [{ tz: 'Asia/Shanghai' }] }).speed, 350);
  assert.equal(serviceInfo({ number: 'G1', operator: 'Local Rail', stops: [{ tz: 'Europe/Paris' }] }), null);
  assert.equal(serviceInfo({ display: 'Line 3', operator: 'NJ Transit' }), null);
  assert.equal(serviceInfo({ display: 'Lexington Ave Line', operator: 'Metro' }), null);
  assert.equal(serviceInfo({ display: 'RE 5', operator: 'Local Rail' }), null);
  assert.equal(serviceInfo({ display: 'SICE 9', operator: 'x' }), null);
});
