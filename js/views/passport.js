import { html, useMemo, useState } from '../../vendor/preact-htm.js';
import { MapView } from '../mapview.js';
import {
  dayLabel, formatDuration, fromStop, kmToMiles, manualTrain, nextMilepost, passportStats, ridePoints, rideYears, stationTimeToUtc, toStopOf, trainName,
} from '../model.js';
import { addTrip, rememberStation, useStore } from '../store.js';
import { countryAt } from '../api.js';
import { Icon, Notice, ViewHeader, distanceText, go, hrefFor, plural, speedText } from '../ui.js';
import { StationPicker } from './find.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MonthBars({ months, units }) {
  const top = Math.max(...months, 1);
  const busiest = months.indexOf(Math.max(...months));
  const [picked, setPicked] = useState(busiest);
  return html`
    <div class="months">
      <p class="months-read" aria-live="polite">${MONTHS[picked]}: ${distanceText(months[picked], units)}</p>
      <div class="monthbars">
        ${months.map((km, i) => html`
          <button key=${MONTHS[i]} class=${`monthbar ${i === picked ? 'is-picked' : ''}`} aria-label=${`${MONTHS[i]}: ${distanceText(km, units)}`} onClick=${() => setPicked(i)}>
            <span class="monthbar-track"><i style=${{ height: km ? `${Math.max(4, (km / top) * 100)}%` : '0' }}></i></span>
            <small>${MONTHS[i][0]}</small>
          </button>`)}
      </div>
    </div>`;
}

// A lifetime measured the way a railway measures a line.
function LifetimeLine({ km, units }) {
  const { next, passed } = nextMilepost(km);
  const start = passed?.km || 0;
  const share = next ? Math.min(100, ((km - start) / (next.km - start)) * 100) : 100;
  const done = passed ? `You have ridden ${passed.done || `past ${distanceText(passed.km, units)}`}. ` : '';
  const ahead = !next ? ''
    : km === 0 ? `Your first milepost is ${distanceText(next.km, units)}.`
    : `${distanceText(next.km - km, units)} to go to ${next.goal || `reach ${distanceText(next.km, units)}`}.`;
  return html`
    <div class="lifetime">
      <div class="lifetime-line" aria-hidden="true">
        <i class="lifetime-fill" style=${{ width: `${share}%` }}></i>
        <i class="lifetime-now" style=${{ left: `${share}%` }}></i>
      </div>
      <p class="lifetime-note">${done}${ahead}</p>
    </div>`;
}

export function PassportView() {
  const store = useStore();
  const units = store.prefs.units;
  const [year, setYear] = useState(null);
  const now = Date.now();
  const years = useMemo(() => rideYears(store.trips, now), [store.trips]);
  const s = useMemo(() => passportStats(store.trips, year, now), [store.trips, year]);
  const lines = useMemo(() => s.rides.map((t) => ridePoints(t.train)), [s.rides]);

  const total = units === 'mi' ? kmToMiles(s.km) : s.km;
  const shownDistance = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(total);
  const isEmpty = !s.rides.length;

  return html`
    <div class="scroll passport">
      <header class="pagehead">
        <h1>Passport</h1>
        <a class="iconbtn" href=${hrefFor('/passport/add')} aria-label="Log a past trip"><${Icon} name="plus"/></a>
      </header>

      ${years.length > 1 ? html`
        <div class="filters" role="group" aria-label="Choose a year">
          <button class="chip" aria-pressed=${!year} onClick=${() => setYear(null)}>All time</button>
          ${years.map((y) => html`<button class="chip" aria-pressed=${year === y} onClick=${() => setYear(y)}>${y}</button>`)}
        </div>` : null}

      <section class="distance">
        <p class="distance-figure">${s.anyApprox ? html`<span class="distance-about">about</span>` : null}<b>${shownDistance}</b><span>${units === 'mi' ? 'miles' : 'km'}</span></p>
        <p class="distance-label">${isEmpty ? 'Finished trains add up here' : `by train, across ${plural(s.rides.length, 'ride')}`}</p>
        <${LifetimeLine} km=${s.km} units=${units}/>
      </section>

      ${isEmpty ? html`
        <${Notice} title="Your first ride goes here"
          action=${html`
            <div class="stackbtns">
              <button class="primary" onClick=${() => go('/')}>Find a train</button>
              <a class="outbtn" href=${hrefFor('/passport/add')}>Log a past trip</a>
            </div>`}>
          Add trains to My Trains and they count here once they finish. You can also log trips you have already taken.
        <//>` : html`
        <div class="passmap"><${MapView} lines=${lines} globe=${true} label=${`Map of ${plural(s.rides.length, 'ride')}`}/></div>

        <dl class="facts passfacts">
          <div><dt>Time on board</dt><dd>${formatDuration(s.minutes)}</dd></div>
          <div><dt>Stations</dt><dd>${s.stationCount}</dd></div>
          <div><dt>Operators</dt><dd>${s.operatorCount}</dd></div>
          <div><dt>Countries</dt><dd>${s.countryCount || 'Not known'}</dd></div>
          ${s.night ? html`<div><dt>Night trains</dt><dd>${s.night}</dd></div>` : null}
          ${s.onTimePercent !== null ? html`<div><dt>On time</dt><dd>${s.onTimePercent}%</dd></div>` : null}
          ${s.liveRides ? html`<div><dt>Minutes lost to delays</dt><dd>${s.lateMinutes}</dd></div>` : null}
        </dl>

        <section class="block">
          <h2>Distance by month</h2>
          <${MonthBars} key=${year || 'all'} months=${s.months} units=${units}/>
          ${!year && years.length > 1 ? html`<p class="block-note">All years combined.</p>` : null}
        </section>

        <section class="block">
          <h2>Records</h2>
          <table class="details">
            <tbody>
              ${s.longest ? html`<tr><th scope="row">Longest ride</th><td>${distanceText(s.longest.km, units)}, ${fromStop(s.longest.trip.train).name} to ${toStopOf(s.longest.trip.train).name}</td></tr>` : null}
              ${s.fastest ? html`<tr><th scope="row">Fastest ride</th><td>${speedText(s.fastest.kmh, units)} average, ${trainName(s.fastest.trip.train)}</td></tr>` : null}
              ${s.topOperator ? html`<tr><th scope="row">Most used operator</th><td>${s.topOperator[0]}, ${plural(s.topOperator[1], 'ride')}</td></tr>` : null}
              ${s.topStation ? html`<tr><th scope="row">Most used station</th><td>${s.topStation.name}</td></tr>` : null}
            </tbody>
          </table>
        </section>

        <section class="block">
          <h2>Your rides</h2>
          <ul class="ridelist">
            ${[...s.rides].reverse().map((trip) => {
              const t = trip.train, from = fromStop(t), to = toStopOf(t);
              return html`
                <li key=${trip.id}>
                  <a href=${hrefFor('/train', { trip: t.tripId, from: from.id, to: to.id, saved: trip.id })}>
                    <b>${from.name} to ${to.name}</b>
                    <small>${dayLabel(from.schedDep, from.tz)}, ${trainName(t)}</small>
                  </a>
                </li>`;
            })}
          </ul>
        </section>`}
    </div>`;
}

export function AddRideView() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ from: null, to: null, date: today, dep: '09:00', arr: '12:00', operator: '', name: '', mode: 'LONG_DISTANCE' });
  const [picking, setPicking] = useState(null);
  const [problem, setProblem] = useState('');
  const set = (patch) => { setF((v) => ({ ...v, ...patch })); setProblem(''); };

  function pick(station) {
    rememberStation(station);
    set({ [picking]: station });
    setPicking(null);
  }

  async function save() {
    if (!f.from || !f.to) { setProblem('Choose both stations.'); return; }
    if (f.from.id === f.to.id) { setProblem('Choose two different stations.'); return; }
    const departIso = stationTimeToUtc(f.date, f.dep, f.from.tz);
    let arriveIso = stationTimeToUtc(f.date, f.arr, f.to.tz);
    if (new Date(arriveIso) <= new Date(departIso)) arriveIso = new Date(+new Date(arriveIso) + 86400000).toISOString();
    if (new Date(arriveIso) > new Date()) { setProblem('Log trips that have already finished. For a future train, use Find.'); return; }
    const train = manualTrain({ from: f.from, to: f.to, departIso, arriveIso, operator: f.operator.trim(), name: f.name.trim(), mode: f.mode });
    const countries = { from: f.from.country || await countryAt(f.from.lat, f.from.lon), to: f.to.country || await countryAt(f.to.lat, f.to.lon) };
    addTrip(train, { manual: true, countries });
    go('/passport');
  }

  return html`
    <div class="scroll">
      <${ViewHeader} title="Log a past trip" sub="Distance is estimated, since there is no recorded route" fallback="/passport"/>
      <section class="routeform">
        <div class="routefields is-plain">
          <button class=${`routefield ${f.from ? '' : 'is-empty'}`} onClick=${() => setPicking('from')}>
            <i class="node" aria-hidden="true"></i><small>From</small><b>${f.from?.name || 'Choose a station'}</b>
          </button>
          <button class=${`routefield ${f.to ? '' : 'is-empty'}`} onClick=${() => setPicking('to')}>
            <i class="node" aria-hidden="true"></i><small>To</small><b>${f.to?.name || 'Choose a station'}</b>
          </button>
        </div>
        <div class="datetime is-three">
          <label class="wide">Date<input id="ride-date" type="date" value=${f.date} max=${today} onInput=${(e) => set({ date: e.target.value })}/></label>
          <label>Departed<input id="ride-dep" type="time" value=${f.dep} onInput=${(e) => set({ dep: e.target.value })}/></label>
          <label>Arrived<input id="ride-arr" type="time" value=${f.arr} onInput=${(e) => set({ arr: e.target.value })}/></label>
        </div>
        <label class="field">Operator<input id="ride-operator" type="text" placeholder="For example, ÖBB" value=${f.operator} onInput=${(e) => set({ operator: e.target.value })}/></label>
        <label class="field">Train name or number<input id="ride-name" type="text" placeholder="For example, RJX 63" value=${f.name} onInput=${(e) => set({ name: e.target.value })}/></label>
        <label class="field">Type of train
          <select id="ride-mode" value=${f.mode} onChange=${(e) => set({ mode: e.target.value })}>
            <option value="LONG_DISTANCE">Intercity</option>
            <option value="HIGHSPEED_RAIL">High-speed</option>
            <option value="NIGHT_RAIL">Night train</option>
            <option value="REGIONAL_RAIL">Regional</option>
            <option value="SUBURBAN">Commuter</option>
          </select>
        </label>
        ${problem ? html`<p class="formnote" role="alert">${problem}</p>` : null}
        <button class="primary" onClick=${save}>Add to Passport</button>
      </section>
      ${picking ? html`<${StationPicker} title=${picking === 'from' ? 'Departure station' : 'Arrival station'} onPick=${pick} onClose=${() => setPicking(null)}/>` : null}
    </div>`;
}
