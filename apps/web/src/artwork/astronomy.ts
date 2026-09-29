/**
 * Where the sun and moon sit for an observer, to a fraction of a degree: enough
 * to colour a sky, not to point a telescope. After Vladimir Agafonkin's
 * SunCalc, which follows the low-precision formulas in Meeus.
 */

const rad = Math.PI / 180;
const obliquity = rad * 23.4397;

const toDays = (ms: number) => ms / 86_400_000 - 0.5 + 2_440_588 - 2_451_545;

const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(obliquity) - Math.tan(b) * Math.sin(obliquity), Math.cos(l));
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(obliquity) + Math.cos(b) * Math.sin(obliquity) * Math.sin(l));
const siderealTime = (d: number, lw: number) => rad * (280.16 + 360.9856235 * d) - lw;

function sunCoords(d: number) {
  const m = rad * (357.5291 + 0.98560028 * d);
  const center = rad * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const l = m + center + rad * 102.9372 + Math.PI;
  return { dec: declination(l, 0), ra: rightAscension(l, 0) };
}

function moonCoords(d: number) {
  const l = rad * (218.316 + 13.176396 * d);
  const m = rad * (134.963 + 13.064993 * d);
  const f = rad * (93.272 + 13.22935 * d);
  const longitude = l + rad * 6.289 * Math.sin(m);
  const latitude = rad * 5.128 * Math.sin(f);
  return {
    ra: rightAscension(longitude, latitude),
    dec: declination(longitude, latitude),
    dist: 385_001 - 20_905 * Math.cos(m),
  };
}

/** Degrees above the horizon, and compass bearing in degrees from north. */
export type SkyPosition = { readonly altitude: number; readonly azimuth: number };

function position(hourAngle: number, latitude: number, dec: number): SkyPosition {
  const phi = rad * latitude;
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle),
  );
  const fromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
  );
  return { altitude: altitude / rad, azimuth: (fromSouth / rad + 540) % 360 };
}

export function sunPosition(ms: number, latitude: number, longitude: number): SkyPosition {
  const d = toDays(ms);
  const sun = sunCoords(d);
  return position(siderealTime(d, rad * -longitude) - sun.ra, latitude, sun.dec);
}

export function moonPosition(ms: number, latitude: number, longitude: number): SkyPosition {
  const d = toDays(ms);
  const moon = moonCoords(d);
  return position(siderealTime(d, rad * -longitude) - moon.ra, latitude, moon.dec);
}

/** How much of the disc is lit (0..1), and whether it is growing. */
export function moonIllumination(ms: number): { fraction: number; waxing: boolean } {
  const d = toDays(ms);
  const sun = sunCoords(d);
  const moon = moonCoords(d);
  const sunDistance = 149_598_000;
  const elongation = Math.acos(
    Math.sin(sun.dec) * Math.sin(moon.dec) +
      Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra),
  );
  const inclination = Math.atan2(
    sunDistance * Math.sin(elongation),
    moon.dist - sunDistance * Math.cos(elongation),
  );
  const angle = Math.atan2(
    Math.cos(sun.dec) * Math.sin(sun.ra - moon.ra),
    Math.sin(sun.dec) * Math.cos(moon.dec) -
      Math.cos(sun.dec) * Math.sin(moon.dec) * Math.cos(sun.ra - moon.ra),
  );
  return { fraction: (1 + Math.cos(inclination)) / 2, waxing: angle < 0 };
}
