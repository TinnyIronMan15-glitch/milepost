// A map that always shows something. A drawn sketch of the route sits underneath, and the real
// map fades in over it when the map library and tiles load, so no signal never means a blank panel.
import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { MAP_STYLES } from './config.js';

let library;

function loadLibrary() {
  if (library) return library;
  library = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/maplibre-gl.css';
    document.head.append(css);
    const script = document.createElement('script');
    script.src = 'vendor/maplibre-gl.js';
    script.onload = () => resolve(window.maplibregl);
    script.onerror = reject;
    document.head.append(script);
  });
  library.catch(() => { library = null; });
  return library;
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const lonLat = ([lat, lon]) => [lon, lat];

function boundsOf(lines) {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const line of lines) {
    for (const [lat, lon] of line) {
      w = Math.min(w, lon); e = Math.max(e, lon);
      s = Math.min(s, lat); n = Math.max(n, lat);
    }
  }
  return { w, e, s, n };
}

function Sketch({ lines, faint, marks }) {
  const all = [...lines, ...faint];
  if (!all.length || !all.some((l) => l.length)) return null;
  const { w, e, s, n } = boundsOf(all);
  const scaleX = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const spanX = Math.max((e - w) * scaleX, 0.01), spanY = Math.max(n - s, 0.01);
  const W = 400, H = 240, pad = 34;
  const k = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const x0 = (W - spanX * k) / 2, y0 = (H - spanY * k) / 2;
  const project = ([lat, lon]) => [x0 + (lon - w) * scaleX * k, y0 + (n - lat) * k];
  const path = (line) => line.map(project).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return html`
    <svg class="sketch" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      ${faint.map((l) => html`<path class="sketch-faint" d=${path(l)}/>`)}
      ${lines.map((l) => html`<path class="sketch-line" d=${path(l)}/>`)}
      ${marks.map((m) => { const [x, y] = project(m); return html`<circle class="sketch-mark" cx=${x} cy=${y} r="5"/>`; })}
    </svg>`;
}

export function MapView({ lines = [], faint = [], marks = [], train = null, globe = false, label }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const trainMarker = useRef(null);
  const [ready, setReady] = useState(false);
  const signature = useMemo(() => JSON.stringify([lines.map((l) => [l.length, l[0], l[l.length - 1]]), faint.length, globe]), [lines, faint, globe]);

  useEffect(() => {
    if (!lines.some((l) => l.length > 1) || navigator.onLine === false) return undefined;
    let cancelled = false;
    let map;
    setReady(false);
    loadLibrary().then((lib) => {
      if (cancelled || !box.current) return;
      const { w, e, s, n } = boundsOf([...lines]);
      map = new lib.Map({
        container: box.current,
        style: isDark() ? MAP_STYLES.dark : MAP_STYLES.light,
        bounds: [[w, s], [e, n]],
        fitBoundsOptions: { padding: { top: 44, bottom: 44, left: 44, right: 44 }, maxZoom: 11 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      map.on('style.load', () => { if (globe) map.setProjection({ type: 'globe' }); });
      map.on('load', () => {
        const accent = cssVar('--brass');
        const shade = cssVar('--ground');
        const asLine = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map(lonLat) } });
        if (faint.length) {
          map.addSource('faint', { type: 'geojson', data: { type: 'FeatureCollection', features: faint.filter((l) => l.length > 1).map(asLine) } });
          map.addLayer({ id: 'faint', type: 'line', source: 'faint', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 2, 'line-opacity': 0.4 } });
        }
        map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: lines.filter((l) => l.length > 1).map(asLine) } });
        map.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': shade, 'line-width': 7, 'line-opacity': 0.75 } });
        map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 3.5 } });
        if (marks.length) {
          map.addSource('marks', { type: 'geojson', data: { type: 'FeatureCollection', features: marks.map((m) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lonLat(m) } })) } });
          map.addLayer({ id: 'marks', type: 'circle', source: 'marks', paint: { 'circle-radius': 5, 'circle-color': shade, 'circle-stroke-color': accent, 'circle-stroke-width': 2.5 } });
        }
        if (!cancelled) setReady(true);
      });
    }).catch(() => { /* the sketch stays */ });
    return () => {
      cancelled = true;
      trainMarker.current = null;
      mapRef.current = null;
      if (map) map.remove();
    };
  }, [signature]);

  // The moving train is a marker, so it can update without redrawing the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!train) { trainMarker.current?.remove(); trainMarker.current = null; return; }
    if (!trainMarker.current) {
      const el = document.createElement('div');
      el.className = 'map-train';
      trainMarker.current = new window.maplibregl.Marker({ element: el }).setLngLat(lonLat(train)).addTo(map);
    } else {
      trainMarker.current.setLngLat(lonLat(train));
    }
  }, [train?.[0], train?.[1], ready]);

  return html`
    <div class=${`mapview ${ready ? 'is-ready' : ''}`} role="img" aria-label=${label || 'Route map'}>
      <${Sketch} lines=${lines} faint=${faint} marks=${marks}/>
      <div class="mapview-canvas" ref=${box}></div>
    </div>`;
}
