import { html, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import { planJourneys } from '../api.js';
import {
  dayLabel, formatDuration, fromStop, minutesBetween, timeParts, toStopOf, trainKind, trainLabel, trainName, trainStatus, transferMinutes, transferRating,
} from '../model.js';
import { addTrip, findTrip, useStore } from '../store.js';
import {
  Clock, DataCredit, Loading, Notice, StopTime, Status, ViewHeader, go, plural, session, trainKey, useNow, usePrefs,
} from '../ui.js';

export function openTrain(train) {
  session.trains.set(trainKey(train.tripId, fromStop(train).id), train);
  go('/train', { trip: train.tripId, from: fromStop(train).id, to: toStopOf(train).id });
}

function openJourney(journey) {
  if (journey.trains.length === 1) { openTrain(journey.trains[0]); return; }
  session.journeys.set(journey.id, journey);
  go('/journey', { id: journey.id });
}

// A small to-scale drawing of the journey. Each dot is a stop, gaps are changes of train.
function JourneyLine({ journey }) {
  const start = +new Date(journey.start);
  const total = Math.max(1, +new Date(journey.end) - start);
  const share = (a, b) => `${((+new Date(b) - +new Date(a)) / total) * 100}%`;
  const parts = [];
  journey.trains.forEach((t, i) => {
    const from = fromStop(t), to = toStopOf(t);
    const span = Math.max(1, +new Date(to.arr) - +new Date(from.dep));
    parts.push(html`
      <span class="jl-train" style=${{ width: share(from.dep, to.arr) }}>
        ${t.stops.slice(t.board + 1, t.alight).map((s) => html`
          <i style=${{ left: `${((+new Date(s.arr) - +new Date(from.dep)) / span) * 100}%` }}></i>`)}
      </span>`);
    const next = journey.trains[i + 1];
    if (next) parts.push(html`<span class="jl-gap" style=${{ width: share(to.arr, fromStop(next).dep) }}></span>`);
  });
  return html`<div class="jl" aria-hidden="true">${parts}</div>`;
}

function changeText(journey) {
  if (!journey.changes) return 'Direct';
  const places = journey.trains.slice(1).map((t) => fromStop(t).name);
  return `${plural(journey.changes, 'change')} at ${places.join(', ')}`;
}

const journeyDay = (j) => dayLabel(j.start, fromStop(j.trains[0]).tz);

function JourneyRow({ journey, now, showDay }) {
  const first = journey.trains[0], last = journey.trains[journey.trains.length - 1];
  const from = fromStop(first), to = toStopOf(last);
  const status = trainStatus(journey.cancelled ? { ...first, cancelled: true } : first, now);
  const names = journey.trains.map(trainLabel).join(', ');
  return html`
    <li>
      <button class="journey" onClick=${() => openJourney(journey)}>
        <div class="journey-times">
          <${StopTime} actual=${from.dep} sched=${from.schedDep} tz=${from.tz} class="big"/>
          <span class="journey-duration">${formatDuration(journey.minutes)}</span>
          <${StopTime} actual=${to.arr} sched=${to.schedArr} tz=${to.tz} class="big end"/>
        </div>
        <${JourneyLine} journey=${journey}/>
        <div class="journey-who">
          <b>${journey.operators.join(', ') || 'Operator not listed'}</b>
          <span>${names}</span>
        </div>
        <div class="journey-foot">
          <span>${showDay ? `${journeyDay(journey)}, ` : ''}${changeText(journey)}</span>
          <${Status} status=${status}/>
        </div>
      </button>
    </li>`;
}

const SORTS = [
  { id: 'soonest', label: 'Soonest', by: (a, b) => new Date(a.start) - new Date(b.start) },
  { id: 'fastest', label: 'Fastest', by: (a, b) => a.minutes - b.minutes },
  { id: 'changes', label: 'Fewest changes', by: (a, b) => a.changes - b.changes || new Date(a.start) - new Date(b.start) },
];

const FRESH_MS = 10 * 60000;

export function ResultsView({ q }) {
  const key = `${q.f}|${q.t}|${q.at}`;
  const [data, setData] = useState(() => {
    const kept = session.results.get(key);
    return kept && Date.now() - kept.at < FRESH_MS ? kept : { status: 'loading', items: [], next: '', previous: '', at: Date.now() };
  });
  const [sort, setSort] = useState('soonest');
  const [directOnly, setDirectOnly] = useState(false);
  const [paging, setPaging] = useState('');
  const now = useNow();

  useEffect(() => {
    if (data.status === 'done') return undefined;
    const ctrl = new AbortController();
    setData((d) => ({ ...d, status: 'loading' }));
    planJourneys({ from: q.f, to: q.t, time: q.at }, ctrl.signal)
      .then((r) => setData({ status: 'done', items: r.itineraries, next: r.next, previous: r.previous, at: Date.now() }))
      .catch((err) => { if (err.name !== 'AbortError') setData((d) => ({ ...d, status: 'error', error: err })); });
    return () => ctrl.abort();
  }, [key, data.retry]);

  useEffect(() => { if (data.status === 'done') session.results.set(key, data); }, [data]);

  async function page(direction) {
    setPaging(direction);
    try {
      const r = await planJourneys({ from: q.f, to: q.t, time: q.at, cursor: direction === 'later' ? data.next : data.previous });
      const seen = new Set(data.items.map((i) => i.id));
      const fresh = r.itineraries.filter((i) => !seen.has(i.id));
      setData((d) => ({
        ...d,
        items: direction === 'later' ? [...d.items, ...fresh] : [...fresh, ...d.items],
        next: direction === 'later' ? r.next : d.next,
        previous: direction === 'earlier' ? r.previous : d.previous,
      }));
    } catch (err) {
      setData((d) => ({ ...d, pageError: err.message }));
    } finally {
      setPaging('');
    }
  }

  const shown = useMemo(() => {
    const by = SORTS.find((s) => s.id === sort).by;
    return data.items.filter((i) => !directOnly || !i.changes).sort(by);
  }, [data.items, sort, directOnly]);

  const hasChanges = data.items.some((i) => i.changes);
  const title = `${q.fn || 'Departure'} to ${q.tn || 'arrival'}`;
  const prefs = usePrefs();
  const from = timeParts(q.at, q.tz, prefs.hour12);
  const sub = `Leaving from ${dayLabel(q.at, q.tz)}, ${from.clock}${from.suffix}`;

  return html`
    <div class="scroll">
      <${ViewHeader} title=${title} sub=${sub}/>
      ${data.status === 'loading' ? html`<${Loading} label="Reading timetables"/>` : null}

      ${data.status === 'error' ? html`
        <${Notice} title="No results yet"
          action=${html`<button class="primary" onClick=${() => setData((d) => ({ ...d, status: 'loading', retry: (d.retry || 0) + 1 }))}>Try again</button>`}>
          ${data.error?.message}
        <//>` : null}

      ${data.status === 'done' && !data.items.length ? html`
        <${Notice} title="No trains found">
          Nothing runs between these stations around that time, or an operator on this route does not publish its timetable. Try another time or a nearby larger station.
        <//>` : null}

      ${data.items.length ? html`
        <div class="filters" role="group" aria-label="Sort trains">
          ${SORTS.map((s) => html`<button class="chip" aria-pressed=${sort === s.id} onClick=${() => setSort(s.id)}>${s.label}</button>`)}
          ${hasChanges ? html`<button class="chip" aria-pressed=${directOnly} onClick=${() => setDirectOnly(!directOnly)}>Direct only</button>` : null}
        </div>
        ${data.previous ? html`<button class="pagebtn" disabled=${!!paging} onClick=${() => page('earlier')}>${paging === 'earlier' ? 'Loading' : 'Earlier trains'}</button>` : null}
        <ul class="journeys">
          ${shown.map((j, i) => {
            const byDay = sort === 'soonest';
            const newDay = byDay && (i === 0 || journeyDay(j) !== journeyDay(shown[i - 1]));
            return html`
              ${newDay ? html`<li class="dayhead" key=${`day-${journeyDay(j)}`}><h2>${journeyDay(j)}</h2></li>` : null}
              <${JourneyRow} key=${j.id} journey=${j} now=${now} showDay=${!byDay}/>`;
          })}
        </ul>
        ${directOnly && !shown.length ? html`<p class="hint">None of these are direct. Turn off Direct only, or load later trains.</p>` : null}
        ${data.pageError ? html`<p class="hint">${data.pageError}</p>` : null}
        ${data.next ? html`<button class="pagebtn" disabled=${!!paging} onClick=${() => page('later')}>${paging === 'later' ? 'Loading' : 'Later trains'}</button>` : null}
        <p class="hint">Times are local to each station. Buy tickets from the operator.</p>
        <${DataCredit}/>` : null}
    </div>`;
}

export function JourneyView({ q }) {
  const journey = session.journeys.get(q.id);
  useStore();
  const now = useNow();
  useEffect(() => { if (!journey) go('/'); }, []);
  if (!journey) return null;
  const first = journey.trains[0], last = journey.trains[journey.trains.length - 1];
  const allSaved = journey.trains.every((t) => findTrip(t));
  return html`
    <div class="scroll">
      <${ViewHeader} title=${`${fromStop(first).name} to ${toStopOf(last).name}`}
        sub=${`${formatDuration(journey.minutes)} with ${plural(journey.changes, 'change')}`}/>
      <ol class="legs">
        ${journey.trains.map((t, i) => {
          const from = fromStop(t), to = toStopOf(t);
          const next = journey.trains[i + 1];
          const gap = next ? transferMinutes(t, next) : null;
          const rating = next ? transferRating(gap) : null;
          return html`
            <li key=${t.tripId + i}>
              <button class="leg" onClick=${() => openTrain(t)}>
                <span class="leg-name"><b>${trainName(t)}</b><span>${t.operator || 'Operator not listed'}, ${trainKind(t).toLowerCase()}</span></span>
                <span class="leg-row"><${Clock} iso=${from.dep} tz=${from.tz}/><span>${from.name}</span></span>
                <span class="leg-row"><${Clock} iso=${to.arr} tz=${to.tz}/><span>${to.name}</span></span>
                <${Status} status=${trainStatus(t, now)}/>
              </button>
              ${next ? html`
                <p class=${`transfer is-${rating.code}`}>
                  <b>${rating.label}.</b> ${gap >= 0 ? `${formatDuration(gap)} to change at ${to.name}.` : `The first train now arrives ${formatDuration(-gap)} after the second leaves.`}
                </p>` : null}
            </li>`;
        })}
      </ol>
      <div class="actions">
        <button class="primary" disabled=${allSaved} onClick=${() => journey.trains.forEach((t) => addTrip(t))}>
          ${allSaved ? 'In My Trains' : 'Add all trains to My Trains'}
        </button>
      </div>
    </div>`;
}

export { minutesBetween };
