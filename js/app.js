import { html, render, useEffect, useErrorBoundary, useLayoutEffect, useRef } from '../vendor/preact-htm.js';
import { catchUp } from './track.js';
import { Icon, Notice, hrefFor, useRoute } from './ui.js';
import { AboutView } from './views/about.js';
import { FindView } from './views/find.js';
import { MineView } from './views/mine.js';
import { AddRideView, PassportView } from './views/passport.js';
import { JourneyView, ResultsView } from './views/results.js';
import { TrainView } from './views/train.js';

const TABS = [
  { path: '/', label: 'Find', icon: 'find', owns: ['/', '/results', '/journey', '/about'] },
  { path: '/mine', label: 'My Trains', icon: 'train', owns: ['/mine'] },
  { path: '/passport', label: 'Passport', icon: 'passport', owns: ['/passport', '/passport/add'] },
];

// A train page belongs to the tab it was opened from.
function tabFor({ path, q }) {
  if (path === '/train') return q.saved ? '/mine' : '/';
  return TABS.find((t) => t.owns.includes(path))?.path || '/';
}

function View({ route }) {
  const { path, q } = route;
  switch (path) {
    case '/results': return html`<${ResultsView} key=${`${q.f}${q.t}${q.at}`} q=${q}/>`;
    case '/journey': return html`<${JourneyView} q=${q}/>`;
    case '/train': return html`<${TrainView} key=${`${q.trip}${q.from}${q.saved}`} q=${q}/>`;
    case '/mine': return html`<${MineView}/>`;
    case '/passport': return html`<${PassportView}/>`;
    case '/passport/add': return html`<${AddRideView}/>`;
    case '/about': return html`<${AboutView}/>`;
    default: return html`<${FindView}/>`;
  }
}

function App() {
  const route = useRoute();
  const [crash, reset] = useErrorBoundary();
  const main = useRef(null);

  // Every screen opens at its top.
  useLayoutEffect(() => { main.current?.querySelector('.scroll')?.scrollTo(0, 0); }, [location.hash]);

  useEffect(() => {
    catchUp();
    const onShow = () => { if (document.visibilityState === 'visible') catchUp(); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  useEffect(() => { if (crash) console.error(crash); }, [crash]);
  useEffect(() => { if (crash) reset(); }, [route.path]);

  return html`
    <div class="app">
      <main class="main" ref=${main}>
        ${crash
          ? html`<div class="scroll"><${Notice} title="This screen stopped working"
              action=${html`<button class="primary" onClick=${() => { reset(); location.hash = '#/'; }}>Back to Find</button>`}>
              Your saved trains are safe. Go back and try again.<//></div>`
          : html`<${View} route=${route}/>`}
      </main>
      <nav class="tabs" aria-label="Main">
        ${TABS.map((t) => html`
          <a href=${hrefFor(t.path)} class="tab" aria-current=${tabFor(route) === t.path ? 'page' : null}>
            <${Icon} name=${t.icon}/><span>${t.label}</span>
          </a>`)}
      </nav>
    </div>`;
}

render(html`<${App}/>`, document.getElementById('root'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // A new version takes over while the app opens. Reload once so it shows straight away.
  const updating = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works online */ });
}
navigator.storage?.persist?.().catch?.(() => {});
