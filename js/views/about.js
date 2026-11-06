import { html, useRef, useState } from '../../vendor/preact-htm.js';
import { APP, LINKS } from '../config.js';
import { exportBackup, importBackup, setPrefs, useStore } from '../store.js';
import { ViewHeader, plural } from '../ui.js';

async function saveBackup() {
  const name = `milepost-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([exportBackup()], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Milepost backup' });
      return 'Backup ready.';
    } catch (err) {
      if (err.name === 'AbortError') return '';
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'Backup saved to your downloads.';
}

const External = ({ href, children }) => html`<a href=${href} target="_blank" rel="noopener">${children}</a>`;

export function AboutView() {
  const store = useStore();
  const { prefs } = store;
  const [message, setMessage] = useState('');
  const fileInput = useRef(null);

  async function restore(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setMessage(`Restored ${plural(importBackup(await file.text()), 'train')}.`);
    } catch (err) {
      setMessage(err.message || 'That file could not be read.');
    }
    e.target.value = '';
  }

  return html`
    <div class="scroll">
      <${ViewHeader} title="Settings"/>

      <section class="block">
        <h2>Display</h2>
        <div class="setting">
          <span>Time format</span>
          <div class="segmented" role="group" aria-label="Time format">
            <button aria-pressed=${!prefs.hour12} onClick=${() => setPrefs({ hour12: false })}>24-hour</button>
            <button aria-pressed=${!!prefs.hour12} onClick=${() => setPrefs({ hour12: true })}>12-hour</button>
          </div>
        </div>
        <div class="setting">
          <span>Distance</span>
          <div class="segmented" role="group" aria-label="Distance units">
            <button aria-pressed=${prefs.units === 'km'} onClick=${() => setPrefs({ units: 'km' })}>Kilometres</button>
            <button aria-pressed=${prefs.units === 'mi'} onClick=${() => setPrefs({ units: 'mi' })}>Miles</button>
          </div>
        </div>
      </section>

      <section class="block">
        <h2>Your data</h2>
        <p class="block-text">Your trains and Passport stay on this phone and are not sent anywhere. Save a backup before changing phones.</p>
        <div class="stackbtns">
          <button class="outbtn" onClick=${async () => setMessage(await saveBackup())}>Save a backup</button>
          <button class="outbtn" onClick=${() => fileInput.current?.click()}>Restore a backup</button>
          <input id="restore-file" ref=${fileInput} type="file" accept="application/json,.json" hidden onChange=${restore}/>
        </div>
        ${message ? html`<p class="formnote" role="status">${message}</p>` : null}
      </section>

      <section class="block">
        <h2>What Milepost can and can't do</h2>
        <ul class="plainlist">
          <li>Live delays appear only where the operator publishes them. Everywhere else you see timetable times.</li>
          <li>Train positions are estimated from the times.</li>
          <li>There are no alerts while the app is closed, and on-time history only grows when you open it.</li>
          <li>Coverage depends on open timetable data, so some operators and countries are missing.</li>
        </ul>
      </section>

      <section class="block">
        <h2>Where the data comes from</h2>
        <p class="block-text">
          Timetables and live times come from <${External} href=${LINKS.dataService}>Transitous<//>, a free community service, and the
          <${External} href=${LINKS.dataSources}> operators and data sources it lists<//>.
          Maps use <${External} href=${LINKS.mapTiles}>OpenFreeMap<//> and <${External} href=${LINKS.osm}>OpenStreetMap contributors<//>.
          Transitous runs on donations: <${External} href=${LINKS.donate}>support it here<//>.
        </p>
        ${APP.sourceUrl ? html`<p class="block-text">Milepost is open source. <${External} href=${APP.sourceUrl}>Read the code or get in touch<//>.</p>` : null}
        <p class="block-note">Milepost ${APP.version}</p>
      </section>
    </div>`;
}
