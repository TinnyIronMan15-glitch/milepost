import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { kmToMiles, timeParts, delayMinutes } from './model.js';
import { useStore } from './store.js';
import { LINKS } from './config.js';

/* Routing: the hash is the only URL state, so the app works from any folder of any host. */

export function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, query] = raw.split('?');
  return { path, q: Object.fromEntries(new URLSearchParams(query || '')) };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const update = () => setRoute(parseHash());
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return route;
}

export function hrefFor(path, q = {}) {
  const pairs = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const qs = new URLSearchParams(pairs).toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export const go = (path, q) => { location.hash = hrefFor(path, q); };
export const goBack = (fallback = '/') => (history.length > 1 ? history.back() : go(fallback));

/* Short-lived memory so opening a train does not have to ask the server for what we already hold. */

export const session = {
  trains: new Map(),
  journeys: new Map(),
  results: new Map(),
};

export const trainKey = (tripId, fromId) => `${tripId}|${fromId}`;

export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function usePrefs() {
  return useStore().prefs;
}

/* Words and numbers */

export function distanceText(km, units = 'km', approx = false) {
  const value = units === 'mi' ? kmToMiles(km) : km;
  const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  return `${approx ? '≈ ' : ''}${text} ${units}`;
}

export function speedText(kmh, units = 'km') {
  const value = units === 'mi' ? kmToMiles(kmh) : kmh;
  return `${Math.round(value)} ${units === 'mi' ? 'mph' : 'km/h'}`;
}

export const plural = (n, one, many = `${one}s`) => `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`;

/* Small pieces */

const PATHS = {
  find: html`<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>`,
  train: html`<rect x="5" y="3.5" width="14" height="14" rx="4"/><path d="M5 11h14M9 21l1.5-3.5M15 21l-1.5-3.5"/><circle cx="9" cy="14.3" r=".6" fill="currentColor"/><circle cx="15" cy="14.3" r=".6" fill="currentColor"/>`,
  passport: html`<rect x="5" y="3" width="14" height="18" rx="2.5"/><circle cx="12" cy="11" r="3.6"/><path d="M8.4 11h7.2M12 7.4c2 2.2 2 5 0 7.2M12 7.4c-2 2.2-2 5 0 7.2M9 17.5h6"/>`,
  back: html`<path d="M14.5 5.5 8 12l6.5 6.5"/>`,
  swap: html`<path d="M8 4v15M8 4 4.5 7.5M8 4l3.5 3.5M16 20V5M16 20l3.5-3.5M16 20l-3.5-3.5"/>`,
  plus: html`<path d="M12 5v14M5 12h14"/>`,
  check: html`<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  settings: html`<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`,
  close: html`<path d="M6 6l12 12M18 6 6 18"/>`,
  watch: html`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>`,
  link: html`<path d="M7 17 17 7M9 7h8v8"/>`,
  alert: html`<path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 10v4.5M12 17.4v.1"/>`,
};

export const Icon = ({ name, size = 24 }) => html`
  <svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

export const Clock = ({ iso, tz, class: cls = '' }) => {
  const prefs = usePrefs();
  const p = timeParts(iso, tz, prefs.hour12);
  return html`<span class=${`clock ${cls}`}>${p.clock}${p.suffix ? html`<small>${p.suffix}</small>` : null}</span>`;
};

// Shows the time the train is expected, and the timetable time crossed out when they differ.
export const StopTime = ({ actual, sched, tz, class: cls = '' }) => {
  const moved = Math.abs(delayMinutes(sched, actual)) >= 1;
  return html`
    <span class=${`stoptime ${cls}`}>
      <${Clock} iso=${actual} tz=${tz} class=${moved ? 'is-moved' : ''}/>
      ${moved ? html`<s><span class="sr">Timetable time </span><${Clock} iso=${sched} tz=${tz}/></s>` : null}
    </span>`;
};

export const Status = ({ status }) => html`
  <span class=${`status lamp-${status.lamp}`}><i class="lamp" aria-hidden="true"></i>${status.label}</span>`;

export const Loading = ({ label }) => html`
  <div class="loading" role="status"><span class="sleepers" aria-hidden="true"></span>${label}</div>`;

export const Notice = ({ title, children, action }) => html`
  <div class="notice">
    <h2>${title}</h2>
    <p>${children}</p>
    ${action || null}
  </div>`;

export const ViewHeader = ({ title, sub, fallback = '/', right }) => html`
  <header class="viewhead">
    <button class="iconbtn" onClick=${() => goBack(fallback)} aria-label="Back"><${Icon} name="back"/></button>
    <div class="viewhead-text">
      <h1>${title}</h1>
      ${sub ? html`<p>${sub}</p>` : null}
    </div>
    ${right || null}
  </header>`;

export const DataCredit = () => html`
  <p class="credit">Train data from <a href=${LINKS.dataSources} target="_blank" rel="noopener">Transitous and its sources</a>.</p>`;
