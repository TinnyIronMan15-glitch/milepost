import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { dayLabel, fromStop, onTimeSummary, toStopOf, trainName, trainStatus } from '../model.js';
import { removeWatch, useStore } from '../store.js';
import { catchUp } from '../track.js';
import { Clock, Icon, Notice, Status, go, hrefFor, plural, useNow } from '../ui.js';

function TrainRow({ trip, now }) {
  const t = trip.train;
  const from = fromStop(t), to = toStopOf(t);
  const status = trainStatus(t, now);
  return html`
    <li>
      <a class="minerow" href=${hrefFor('/train', { trip: t.tripId, from: from.id, to: to.id, saved: trip.id })}>
        <span class="minerow-date">${dayLabel(from.dep, from.tz)}</span>
        <span class="minerow-route">
          <span class="minerow-line"><${Clock} iso=${from.dep} tz=${from.tz}/><b>${from.name}</b></span>
          <span class="minerow-line"><${Clock} iso=${to.arr} tz=${to.tz}/><b>${to.name}</b></span>
        </span>
        <span class="minerow-foot">
          <span>${trainName(t)}${t.operator && !trainName(t).includes(t.operator) ? `, ${t.operator}` : ''}</span>
          <${Status} status=${status}/>
        </span>
        ${status.phase === 'after' ? null : html`<span class="minerow-sub">${status.sub}</span>`}
      </a>
    </li>`;
}

export function MineView() {
  const store = useStore();
  const now = useNow();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { catchUp(); }, []);

  const byDep = (a, b) => new Date(fromStop(a.train).dep) - new Date(fromStop(b.train).dep);
  const finished = (t) => +new Date(toStopOf(t.train).arr) < now;
  const coming = store.trips.filter((t) => !finished(t)).sort(byDep);
  const past = store.trips.filter(finished).sort(byDep).reverse();
  const pastShown = showAll ? past : past.slice(0, 8);

  return html`
    <div class="scroll">
      <header class="pagehead"><h1>My Trains</h1></header>

      ${!store.trips.length && !store.watches.length ? html`
        <${Notice} title="No trains yet"
          action=${html`<button class="primary" onClick=${() => go('/')}>Find a train</button>`}>
          Add a train and it stays here with its latest times. Finished trains go into your Passport.
        <//>` : null}

      ${coming.length ? html`
        <section class="minesection">
          <h2>Coming up</h2>
          <ul class="minelist">${coming.map((t) => html`<${TrainRow} key=${t.id} trip=${t} now=${now}/>`)}</ul>
        </section>` : null}

      ${past.length ? html`
        <section class="minesection">
          <h2>Finished</h2>
          <ul class="minelist">${pastShown.map((t) => html`<${TrainRow} key=${t.id} trip=${t} now=${now}/>`)}</ul>
          ${past.length > pastShown.length ? html`<button class="pagebtn" onClick=${() => setShowAll(true)}>Show all ${past.length}</button>` : null}
        </section>` : null}

      ${store.watches.length ? html`
        <section class="minesection">
          <h2>Trains you are watching</h2>
          <p class="block-note">Open the app after a watched train arrives, the same day, to log its run.</p>
          <ul class="watchlist">
            ${store.watches.map((w) => {
              const s = onTimeSummary(store.runs[w.key] || []);
              return html`
                <li key=${w.key}>
                  <span><b>${w.name}</b>
                    <small>${s.total ? `${s.percent === null ? 'No runs completed' : `${s.percent}% on time`} over ${plural(s.total, 'run')}` : 'No runs logged yet'}</small>
                  </span>
                  <button class="iconbtn" aria-label=${`Stop watching ${w.name}`} onClick=${() => removeWatch(w.key)}><${Icon} name="close" size=${20}/></button>
                </li>`;
            })}
          </ul>
        </section>` : null}
    </div>`;
}
