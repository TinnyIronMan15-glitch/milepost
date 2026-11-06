import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { searchStations } from '../api.js';
import { dayKey, clockAt, flag, stationTimeToUtc } from '../model.js';
import { rememberStation, setPrefs, useStore } from '../store.js';
import { DataCredit, Icon, go, hrefFor } from '../ui.js';

// Kept outside the component so the form survives a trip to the results and back.
const form = { from: null, to: null, when: 'now', date: '', time: '' };

const SUGGESTED = [
  { from: { q: 'Toronto Union', cc: 'CA', label: 'Toronto' }, to: { q: 'Montreal Central', cc: 'CA', label: 'Montréal' }, note: 'Canada' },
  { from: { q: 'Wien Hauptbahnhof', cc: 'AT', label: 'Vienna' }, to: { q: 'Praha hlavni nadrazi', cc: 'CZ', label: 'Prague' }, note: 'Austria to Czechia' },
  { from: { q: 'Tokyo', cc: 'JP', label: 'Tokyo' }, to: { q: 'Kyoto', cc: 'JP', label: 'Kyoto' }, note: 'Japan' },
  { from: { q: 'Paris Gare de Lyon', cc: 'FR', label: 'Paris' }, to: { q: 'Lyon Part-Dieu', cc: 'FR', label: 'Lyon' }, note: 'France' },
  { from: { q: 'New Delhi', cc: 'IN', label: 'New Delhi' }, to: { q: 'Mumbai Central', cc: 'IN', label: 'Mumbai' }, note: 'India' },
  { from: { q: 'New York Penn', cc: 'US', label: 'New York' }, to: { q: 'Washington Union', cc: 'US', label: 'Washington' }, note: 'United States' },
];

function StationPicker({ title, onPick, onClose }) {
  const store = useStore();
  const [text, setText] = useState('');
  const [state, setState] = useState({ status: 'idle', items: [] });
  const input = useRef(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setState({ status: 'idle', items: [] }); return undefined; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const items = await searchStations(q, ctrl.signal);
        setState({ status: items.length ? 'done' : 'none', items });
      } catch (err) {
        if (err.name !== 'AbortError') setState({ status: 'error', items: [], message: err.message });
      }
    }, 320);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [text]);

  const showRecents = text.trim().length < 2 && store.recents.length > 0;
  const rows = showRecents ? store.recents : state.items;

  return html`
    <div class="picker" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="picker-head">
        <label class="picker-field">
          <span class="sr">${title}</span>
          <${Icon} name="find" size=${20}/>
          <input id="station-search" ref=${input} type="search" autocomplete="off" autocorrect="off" spellcheck="false"
                 enterkeyhint="search" placeholder="Station or city" value=${text} onInput=${(e) => setText(e.target.value)}/>
        </label>
        <button class="textbtn" onClick=${onClose}>Cancel</button>
      </div>
      <div class="picker-body">
        ${showRecents ? html`<h2 class="minor">Recent stations</h2>` : null}
        ${state.status === 'none' ? html`<p class="hint">No train stations match "${text.trim()}". Try the city name or the local spelling.</p>` : null}
        ${state.status === 'error' ? html`<p class="hint">${state.message}</p>` : null}
        ${state.status === 'idle' && !showRecents ? html`<p class="hint">Type at least two letters. Stations are listed under their local names, so Wien works better than Vienna in some countries.</p>` : null}
        <ul class="stationlist">
          ${rows.map((s) => html`
            <li key=${s.id}>
              <button onClick=${() => onPick(s)}>
                <span class="station-flag" aria-hidden="true">${flag(s.country) || ''}</span>
                <span class="station-text"><b>${s.name}</b>${s.area ? html`<small>${s.area}</small>` : null}</span>
              </button>
            </li>`)}
        </ul>
      </div>
    </div>`;
}

const InstallHint = ({ onDismiss }) => html`
  <aside class="install">
    <p><b>Put Milepost on your Home Screen.</b> In Safari, tap Share, then Add to Home Screen.</p>
    <button class="iconbtn" onClick=${onDismiss} aria-label="Dismiss"><${Icon} name="close" size=${20}/></button>
  </aside>`;

export function FindView() {
  const store = useStore();
  const [, redraw] = useState(0);
  const [picking, setPicking] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState('');
  const update = (patch) => { Object.assign(form, patch); setProblem(''); redraw((n) => n + 1); };

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const onIphone = /iPhone|iPad|iPod/.test(navigator.userAgent);

  function pick(station) {
    rememberStation(station);
    update({ [picking]: station });
    setPicking(null);
  }

  function chooseTime() {
    const tz = form.from?.tz || undefined;
    const nowIso = new Date().toISOString();
    update({ when: 'pick', date: form.date || dayKey(nowIso, tz), time: form.time || clockAt(nowIso, tz) });
  }

  function search(from = form.from, to = form.to) {
    if (!from || !to) { setProblem('Choose both stations to search.'); return; }
    if (from.id === to.id) { setProblem('Choose two different stations.'); return; }
    const at = form.when === 'pick' && form.date && form.time
      ? stationTimeToUtc(form.date, form.time, from.tz)
      : new Date().toISOString();
    go('/results', { f: from.id, fn: from.name, t: to.id, tn: to.name, at, tz: from.tz });
  }

  async function trySuggested(route) {
    setBusy(route.note);
    setProblem('');
    try {
      const find = async ({ q, cc }) => {
        const hits = await searchStations(q);
        return hits.find((h) => !h.country || h.country.toUpperCase() === cc) || null;
      };
      const [from, to] = await Promise.all([find(route.from), find(route.to)]);
      if (!from || !to) { setProblem('That example is not in the data right now. Search for your own stations.'); return; }
      update({ from, to, when: 'now' });
      search(from, to);
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy('');
    }
  }

  return html`
    <div class="scroll">
      <header class="pagehead">
        <h1>Find a train</h1>
        <a class="iconbtn" href=${hrefFor('/about')} aria-label="Settings and data sources"><${Icon} name="settings"/></a>
      </header>

      ${onIphone && !standalone && !store.prefs.installDismissed
        ? html`<${InstallHint} onDismiss=${() => setPrefs({ installDismissed: true })}/>` : null}

      <section class="routeform" aria-label="Search for trains">
        <div class="routefields">
          <button class=${`routefield ${form.from ? '' : 'is-empty'}`} onClick=${() => setPicking('from')}>
            <i class="node" aria-hidden="true"></i>
            <small>From</small>
            <b>${form.from?.name || 'Choose a station'}</b>
          </button>
          <button class=${`routefield ${form.to ? '' : 'is-empty'}`} onClick=${() => setPicking('to')}>
            <i class="node" aria-hidden="true"></i>
            <small>To</small>
            <b>${form.to?.name || 'Choose a station'}</b>
          </button>
          <button class="iconbtn swap" aria-label="Swap stations" onClick=${() => update({ from: form.to, to: form.from })}><${Icon} name="swap" size=${22}/></button>
        </div>

        <div class="segmented" role="group" aria-label="When">
          <button aria-pressed=${form.when === 'now'} onClick=${() => update({ when: 'now' })}>Leave now</button>
          <button aria-pressed=${form.when === 'pick'} onClick=${chooseTime}>Pick a time</button>
        </div>

        ${form.when === 'pick' ? html`
          <div class="datetime">
            <label>Date<input id="search-date" type="date" value=${form.date} onInput=${(e) => update({ date: e.target.value })}/></label>
            <label>Station time<input id="search-time" type="time" value=${form.time} onInput=${(e) => update({ time: e.target.value })}/></label>
          </div>` : null}

        ${problem ? html`<p class="formnote" role="alert">${problem}</p>` : null}
        <button class="primary" onClick=${() => search()}>Find trains</button>
      </section>

      <section class="suggest">
        <h2>Try a route</h2>
        <ul>
          ${SUGGESTED.map((r) => html`
            <li key=${r.note}>
              <button disabled=${!!busy} onClick=${() => trySuggested(r)}>
                <span>${r.from.label} to ${r.to.label}</span>
                <small>${busy === r.note ? 'Finding stations' : r.note}</small>
              </button>
            </li>`)}
        </ul>
      </section>
      <${DataCredit}/>

      ${picking ? html`<${StationPicker} title=${picking === 'from' ? 'Departure station' : 'Arrival station'}
          onPick=${pick} onClose=${() => setPicking(null)}/>` : null}
    </div>`;
}

export { StationPicker };
