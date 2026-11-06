export const APP = {
  name: 'Milepost',
  version: '1.0.4',
  // Public code and contact point. The Transitous usage policy asks for both.
  sourceUrl: 'https://github.com/TinnyIronMan15-glitch/milepost',
};

export const API_BASE = 'https://api.transitous.org/api';

export const LINKS = {
  dataSources: 'https://transitous.org/sources/',
  dataService: 'https://transitous.org/',
  donate: 'https://transitous.org/donate/',
  osm: 'https://www.openstreetmap.org/copyright',
  mapTiles: 'https://openfreemap.org/',
};

export const MAP_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

// Transitous asks projects to stay under 720 journey searches a day and to talk to them before
// going over. With a handful of friends sharing the app, this per-phone limit keeps it well below that.
export const DAILY_SEARCH_LIMIT = 100;
