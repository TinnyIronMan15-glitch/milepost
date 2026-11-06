# Milepost

Find any train, see who runs it, and follow it live. A train tracker for your phone, inspired by what flight trackers do for planes.

Open the app in Safari on an iPhone, tap Share, then Add to Home Screen.

## What it does

- Search between any two stations and compare trains by time, length and changes
- See the operator, train, platform and live delay where the operator publishes it
- Follow a train along a strip map of its line, with distances and an estimated position
- Build an on-time record for the trains you watch
- Keep a Passport of the distance, operators, stations and countries you have ridden

Your trains and Passport stay on your phone. There are no accounts and no server.

## Limits

- Live data exists only where an operator publishes it. Everywhere else the app shows timetable times.
- Train positions are estimated from times, not GPS.
- There are no alerts while the app is closed.
- There are no ticket prices or booking.

## Data and credits

- Timetables and live times: [Transitous](https://transitous.org/) and [its sources](https://transitous.org/sources/), used under the [Transitous usage policy](https://transitous.org/api/). Please [donate](https://transitous.org/donate/) if you can. It is run by volunteers.
- Maps: [OpenFreeMap](https://openfreemap.org/), [OpenMapTiles](https://openmaptiles.org/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Libraries: [Preact](https://preactjs.com/) (MIT), [htm](https://github.com/developit/htm) (Apache 2.0), [MapLibre GL JS](https://maplibre.org/) (BSD 3-Clause).
- Fonts: Barlow and Big Shoulders Display (SIL Open Font License).

Licence texts for the bundled libraries and fonts are in `vendor/licenses`.

This is a non-commercial, open-source project. It keeps journey searches to a small daily limit per phone, in line with the Transitous policy. If you fork it, please stay within that policy.

## Running it

There is no build step. Serve this folder from any static web host. Run the logic tests with `npm test`.

Milepost is released under the MIT License.
