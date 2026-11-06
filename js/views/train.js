import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { countryAt, fetchRun } from '../api.js';
import { MapView } from '../mapview.js';
import {
  ON_TIME_LIMIT_MIN, dayLabel, estimatePosition, formatDuration, fromStop, onTimeSummary, parseTrainLeg, positionCoord,
  ridePoints, serviceKey, toStopOf, trainKind, trainName, trainStatus, tripFacts, withFullRun,
} from '../model.js';
import { serviceInfo } from '../services.js';
import { addTrip, findTrip, isWatched, removeTrip, runsFor, saveFailed, toggleWatch, tripById, updateTrip, useStore } from '../store.js';
import { recordIfFinished } from '../track.js';
import {
  Clock, DataCredit, Icon, Loading, Notice, Status, StopTime, ViewHeader, distanceText, goBack, session, speedText, trainKey, useNow, usePrefs,
} from '../ui.js';

const POLL_MS = 60000;

function locate(leg, fromId, toId) {
  const train = parseTrainLeg(leg);
  const board = train.stops.findIndex((s) => s.id === fromId || s.parent === fromId);
  const after = board >= 0 ? train.stops.slice(board + 1).findIndex((s) => s.id === toId || s.parent === toId) : -1;
  return board >= 0 && after >= 0 ? { ...train, board, alight: board + 1 + after } : train;
}

function StationBlock({ stop, kind, align }) {
  const isDep = kind === 'dep';
  const actual = isDep ? stop.dep : stop.arr;
  const sched = isDep ? stop.schedDep : stop.schedArr;
  const moved = stop.schedTrack && stop.track && stop.schedTrack !== stop.track;
  return html`
    <div class=${`stationblock ${align || ''}`}>
      <span class="stationblock-name">${stop.name}</span>
      <${StopTime} actual=${actual} sched=${sched} tz=${stop.tz} class="huge"/>
      <span class="stationblock-meta">${dayLabel(actual, stop.tz)}</span>
      ${stop.track ? html`<span class=${`platform ${moved ? 'is-changed' : ''}`}>Platform ${stop.track}${moved ? ` (was ${stop.schedTrack})` : ''}</span>` : null}
    </div>`;
}

function StopRow({ stop, index, train, pos, phase, units, kindOf }) {
  const passed = pos ? index <= pos.segment : phase === 'after';
  const isEnd = index === train.board || index === train.alight;
  const useDeparture = index === train.board || index === 0;
  const km = (train.km[index] ?? 0) - (train.km[train.board] ?? 0);
  return html`
    <li class=${`stop ${kindOf} ${passed ? 'is-passed' : ''} ${isEnd ? 'is-end' : ''} ${stop.cancelled ? 'is-cancelled' : ''}`}>
      <span class="stop-km">${kindOf === 'is-ride' ? distanceText(km, units).replace(` ${units}`, '') : ''}</span>
      <span class="stop-rail">
        <i class="node" aria-hidden="true"></i>
        ${pos && pos.segment === index ? html`<i class="loco" style=${{ top: `calc(50% + ${pos.fraction * 100}%)` }} aria-hidden="true"></i>` : null}
      </span>
      <span class="stop-name">
        <b>${stop.name}</b>
        ${stop.cancelled ? html`<small>Stop cancelled</small>` : stop.track ? html`<small>Platform ${stop.track}</small>` : null}
      </span>
      <${StopTime} actual=${useDeparture ? stop.dep : stop.arr} sched=${useDeparture ? stop.schedDep : stop.schedArr} tz=${stop.tz} class="stop-time"/>
    </li>`;
}

function StripMap({ train, pos, phase, units }) {
  const [showBefore, setShowBefore] = useState(false);
  const [showAfter, setShowAfter] = useState(false);
  const before = train.board;
  const after = train.stops.length - 1 - train.alight;
  const rows = [];
  train.stops.forEach((stop, index) => {
    const kindOf = index < train.board ? 'is-before' : index > train.alight ? 'is-after' : 'is-ride';
    if ((kindOf === 'is-before' && !showBefore) || (kindOf === 'is-after' && !showAfter)) return;
    rows.push(html`<${StopRow} key=${`${stop.id}${index}`} stop=${stop} index=${index} train=${train} pos=${pos} phase=${phase} units=${units} kindOf=${kindOf}/>`);
  });
  return html`
    <section class="block">
      <h2>The line</h2>
      <p class="block-note">Distances in ${units === 'mi' ? 'miles' : 'kilometres'} from ${fromStop(train).name}.${pos ? ' The marker is estimated from the times.' : ''}</p>
      ${before ? html`<button class="linkbtn" onClick=${() => setShowBefore(!showBefore)}>${showBefore ? 'Hide' : 'Show'} ${before} earlier ${before === 1 ? 'stop' : 'stops'} from ${train.stops[0].name}</button>` : null}
      <ol class="strip">${rows}</ol>
      ${after ? html`<button class="linkbtn" onClick=${() => setShowAfter(!showAfter)}>${showAfter ? 'Hide' : 'Show'} ${after} later ${after === 1 ? 'stop' : 'stops'} to ${train.stops[train.stops.length - 1].name}</button>` : null}
    </section>`;
}

function TripFacts({ train, units }) {
  const f = tripFacts(train);
  const info = serviceInfo(train);
  return html`
    <section class="block">
      <h2>Trip facts</h2>
      <dl class="facts">
        <div><dt>Distance</dt><dd>${distanceText(f.km, units, f.approx)}</dd></div>
        <div><dt>Scheduled time</dt><dd>${formatDuration(f.minutes)}</dd></div>
        <div><dt>Average speed</dt><dd>${f.approx ? '≈ ' : ''}${speedText(f.kmh, units)}</dd></div>
        <div><dt>Stops on the way</dt><dd>${f.stopsBetween}</dd></div>
      </dl>
      <table class="details">
        <tbody>
          <tr><th scope="row">Operator</th><td>${train.operator || 'Not listed'}</td></tr>
          <tr><th scope="row">Train type</th><td>${trainKind(train)}</td></tr>
          ${train.number ? html`<tr><th scope="row">Train number</th><td>${train.number}</td></tr>` : null}
          ${train.line && ![train.number, train.operator, train.display].includes(train.line) ? html`<tr><th scope="row">Line</th><td>${train.line}</td></tr>` : null}
          ${train.lineLong ? html`<tr><th scope="row">Route</th><td>${train.lineLong}</td></tr>` : null}
          <tr><th scope="row">Runs to</th><td>${train.terminus}</td></tr>
        </tbody>
      </table>
      ${f.approx ? html`<p class="block-note">This operator publishes no route line, so distance is measured stop to stop and reads shorter than the real track.</p>` : null}
      ${info ? html`
        <div class="service">
          <h3>${info.name}</h3>
          <p>${info.note} Top speed up to ${speedText(info.speed, units)}, typical for this service rather than measured on this train.</p>
        </div>` : null}
    </section>`;
}

function RunBars({ runs }) {
  const [picked, setPicked] = useState(null);
  const recent = runs.slice(-24);
  const top = Math.max(30, ...recent.map((r) => r.delay));
  const describe = (r) => {
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${r.date}T12:00:00Z`));
    if (r.cancelled) return `${day}: cancelled`;
    return r.delay <= ON_TIME_LIMIT_MIN ? `${day}: on time at ${r.stop}` : `${day}: ${formatDuration(r.delay)} late at ${r.stop}`;
  };
  const current = picked ?? recent.length - 1;
  return html`
    <div class="runs">
      <p class="runs-read" aria-live="polite">${recent[current] ? describe(recent[current]) : ''}</p>
      <div class="runbars" role="list">
        ${recent.map((r, i) => html`
          <button key=${r.date} role="listitem" class=${`runbar ${r.cancelled ? 'is-cancelled' : r.delay > ON_TIME_LIMIT_MIN ? 'is-late' : 'is-ontime'} ${i === current ? 'is-picked' : ''}`}
                  aria-label=${describe(r)} onClick=${() => setPicked(i)}>
            <i style=${{ height: `${r.cancelled ? 100 : Math.max(8, (r.delay / top) * 100)}%` }}></i>
          </button>`)}
      </div>
      <ul class="runlegend">
        <li class="is-ontime">On time</li><li class="is-late">Late</li><li class="is-cancelled">Cancelled</li>
      </ul>
    </div>`;
}

function OnTimeRecord({ train }) {
  const store = useStore();
  const key = serviceKey(train);
  const runs = store.runs[key] || [];
  const watching = isWatched(train);
  const s = onTimeSummary(runs);
  const canLog = train.realTime;
  return html`
    <section class="block">
      <h2>On-time record</h2>
      ${runs.length ? html`
        <dl class="facts">
          <div><dt>On time</dt><dd>${s.percent === null ? 'None ran' : `${s.percent}%`}</dd></div>
          <div><dt>Runs logged</dt><dd>${s.total}</dd></div>
          <div><dt>Average when late</dt><dd>${s.averageLate ? formatDuration(s.averageLate) : 'Not late yet'}</dd></div>
          <div><dt>Worst delay</dt><dd>${s.worst ? formatDuration(s.worst) : 'None'}</dd></div>
        </dl>
        <${RunBars} runs=${runs}/>
        <p class="block-note">From runs this phone has logged. On time means within ${ON_TIME_LIMIT_MIN} minutes at the last stop.</p>` : null}
      ${!runs.length && canLog ? html`<p class="block-text">Nobody publishes train punctuality worldwide, so Milepost builds this record itself. Watch this train, then open the app the day it runs, after it arrives. Live times for finished trains don't last, so a day you skip stays unlogged.</p>` : null}
      ${!runs.length && !canLog ? html`<p class="block-text">This train has no live data right now, so there is nothing to log yet. If the operator publishes live times close to departure, watching it will build a record.</p>` : null}
      <button class=${`togglebtn ${watching ? 'is-on' : ''}`} aria-pressed=${watching} onClick=${() => toggleWatch(train)}>
        <${Icon} name=${watching ? 'check' : 'watch'} size=${20}/>${watching ? 'Watching this train' : 'Watch this train'}
      </button>
    </section>`;
}

export function TrainView({ q }) {
  const saved = q.saved ? tripById(q.saved) : null;
  const [train, setTrain] = useState(() => saved?.train || session.trains.get(trainKey(q.trip, q.from)) || null);
  const [error, setError] = useState('');
  const prefs = usePrefs();
  useStore();
  const now = useNow(20000);
  const tripId = q.trip || saved?.train?.tripId;

  async function refresh(signal) {
    if (!tripId) return;
    try {
      const leg = await fetchRun(tripId, signal);
      if (!leg) { setError('This train is no longer in the timetable data.'); return; }
      setError('');
      setTrain((current) => {
        const next = current ? withFullRun(current, leg) : locate(leg, q.from, q.to);
        recordIfFinished(next);
        const trip = findTrip(next);
        if (trip) updateTrip(trip.id, { train: next });
        return next;
      });
    } catch (err) {
      if (err.name !== 'AbortError' && !train) setError(err.message);
    }
  }

  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [tripId]);

  // Keep a train that is close to running up to date while it is on screen.
  useEffect(() => {
    if (!train || !tripId) return undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const dep = +new Date(fromStop(train).dep), arr = +new Date(toStopOf(train).arr);
      const t = Date.now();
      if (t > dep - 3 * 3600000 && t < arr + 30 * 60000) refresh();
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [tripId, !!train]);

  if (!train) {
    return html`
      <div class="scroll">
        <${ViewHeader} title="Train"/>
        ${error ? html`<${Notice} title="This train did not load">${error}<//>` : html`<${Loading} label="Finding this train"/>`}
      </div>`;
  }

  const from = fromStop(train), to = toStopOf(train);
  const status = trainStatus(train, now);
  const pos = !train.cancelled ? estimatePosition(train, now) : null;
  const coord = positionCoord(train, pos);
  const trip = findTrip(train);
  const ride = ridePoints(train);
  const faint = train.points.length > ride.length ? [train.points] : [];

  async function add() {
    const id = addTrip(train);
    const [a, b] = await Promise.all([countryAt(from.lat, from.lon), countryAt(to.lat, to.lon)]);
    updateTrip(id, { countries: { from: a, to: b } });
  }

  return html`
    <div class="scroll trainview">
      <div class="trainmap">
        <${MapView} lines=${[ride]} faint=${faint} marks=${[[from.lat, from.lon], [to.lat, to.lon]]} train=${coord}
          label=${`Map of the route from ${from.name} to ${to.name}`}/>
        <button class="iconbtn floating" onClick=${() => goBack('/')} aria-label="Back"><${Icon} name="back"/></button>
      </div>

      <div class="trainsheet">
        <header class="trainhead">
          <h1>${trainName(train)}</h1>
          <p>${train.operator || 'Operator not listed'}, ${trainKind(train).toLowerCase()} to ${train.terminus}</p>
        </header>

        <div class="statusband">
          <${Status} status=${status}/>
          <span class="statusband-sub">${status.sub}</span>
        </div>
        ${status.code === 'scheduled' && status.phase !== 'after'
          ? html`<p class="block-note">No live data for this train right now. These are timetable times.</p>` : null}

        <div class="stations">
          <${StationBlock} stop=${from} kind="dep"/>
          <${StationBlock} stop=${to} kind="arr" align="end"/>
        </div>

        ${train.alerts.length ? html`
          <section class="alerts" aria-label="Service alerts">
            ${train.alerts.slice(0, 4).map((a) => html`
              <div class="alert">
                <${Icon} name="alert" size=${20}/>
                <div>
                  ${a.title ? html`<b>${a.title}</b>` : null}
                  ${a.text ? html`<p>${a.text}</p>` : null}
                  ${a.url ? html`<a href=${a.url} target="_blank" rel="noopener">More from the operator</a>` : null}
                </div>
              </div>`)}
          </section>` : null}

        <div class="actions">
          ${trip
            ? html`<button class="primary is-done" onClick=${() => goBack('/mine')}><${Icon} name="check" size=${20}/>In My Trains</button>`
            : html`<button class="primary" onClick=${add}><${Icon} name="plus" size=${20}/>Add to My Trains</button>`}
          ${saveFailed() ? html`<p class="formnote">Your phone would not save this. Free up some storage and try again.</p>` : null}
        </div>

        <${StripMap} train=${train} pos=${pos} phase=${status.phase} units=${prefs.units}/>
        <${TripFacts} train=${train} units=${prefs.units}/>
        ${train.tripId ? html`<${OnTimeRecord} train=${train}/>` : null}

        ${train.operatorUrl || train.routeUrl ? html`
          <section class="block">
            <h2>Tickets</h2>
            <p class="block-text">Milepost does not sell tickets or show prices.</p>
            <a class="outbtn" href=${train.operatorUrl || train.routeUrl} target="_blank" rel="noopener">Open ${train.operator || 'operator'} website<${Icon} name="link" size=${18}/></a>
          </section>` : null}

        ${trip ? html`<button class="dangerbtn" onClick=${() => removeTrip(trip.id)}>Remove from My Trains</button>` : null}
        <${DataCredit}/>
      </div>
    </div>`;
}

export { Clock };
