// What is generally known about famous train services. The data feeds rarely say which physical
// train is running, so these describe the service as a whole and the app labels them "typical".
// Each entry: a test against the train's name, operator and number, then the facts to show.
// Short or common patterns also name a time zone, so they cannot match a train elsewhere.

const SERVICES = [
  { tz: 'Asia/Tokyo', test: /shinkansen|nozomi|hikari|kodama|hayabusa|hayate|komachi|tsubasa|kagayaki|hakutaka|mizuho|sakura|tsubame/i, name: 'Shinkansen', speed: 320, note: "Japan's high-speed network. Top speed depends on the line." },
  { test: /\bICE\b/, name: 'ICE', speed: 300, note: "Germany's main high-speed service." },
  { test: /\bTGV\b|inoui|ouigo/i, name: 'TGV', speed: 320, note: "France's high-speed service, including INOUI and OUIGO." },
  { test: /eurostar|thalys/i, name: 'Eurostar', speed: 300, note: 'High-speed service linking Britain and northwest Europe.' },
  { test: /\bAVE\b|\bAVLO\b/, name: 'AVE', speed: 310, note: "Spain's high-speed service." },
  { test: /frecciarossa/i, name: 'Frecciarossa', speed: 300, note: "Trenitalia's fastest service." },
  { test: /\bitalo\b/i, name: 'Italo', speed: 300, note: "Italy's private high-speed operator." },
  { test: /\bRJX?\b|[Rr]ailjet/, name: 'Railjet', speed: 230, note: "ÖBB's premium long-distance service across central Europe." },
  { test: /nightjet|^NJ\s?\d+/i, name: 'Nightjet', speed: 230, note: "ÖBB's sleeper network." },
  { test: /\bKTX\b/i, name: 'KTX', speed: 305, note: "South Korea's high-speed service." },
  { test: /acela/i, name: 'Acela', speed: 257, note: "Amtrak's high-speed service on the Northeast Corridor." },
  { test: /vande bharat/i, name: 'Vande Bharat', speed: 160, note: "India's semi-high-speed electric service." },
  { tz: 'Asia/Shanghai', test: /^G\d{1,5}$/, name: 'China high-speed G train', speed: 350, note: 'The fastest class on the Chinese network.' },
  { tz: 'Asia/Shanghai', test: /^D\d{1,5}$/, name: 'China D train', speed: 250, note: 'High-speed class on the Chinese network.' },
];

export function serviceInfo(train) {
  const text = [train.display, train.category, train.number, train.line, train.lineLong, train.operator].filter(Boolean);
  for (const service of SERVICES) {
    if (service.tz && train.stops?.[0]?.tz !== service.tz) continue;
    if (text.some((t) => service.test.test(t))) return service;
  }
  return null;
}
