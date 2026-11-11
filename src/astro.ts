import { Vector3 } from 'three';

const DEG = Math.PI / 180;

const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * Point on Earth where the Sun is at the zenith, in degrees.
 * Low-precision Astronomical Almanac formulas (accurate to ~0.01°, plenty for a terminator).
 */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const n = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000.0
  const meanLon = 280.46 + 0.9856474 * n;
  const meanAnomaly = (357.528 + 0.9856003 * n) * DEG;
  const eclipticLon =
    (meanLon + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;

  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLon),
    Math.cos(eclipticLon),
  );
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const gmst = 280.46061837 + 360.98564736629 * n;

  return { lat: declination / DEG, lon: wrap180(rightAscension / DEG - gmst) };
}

/**
 * Unit vector for a geographic point in the globe's local frame.
 * Matches THREE.SphereGeometry UVs with an equirectangular map: lon 0 → +X, lon 90°E → −Z, north → +Y.
 */
export function latLonToVector(lat: number, lon: number, target = new Vector3()): Vector3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return target.set(
    Math.cos(phi) * Math.cos(lambda),
    Math.sin(phi),
    -Math.cos(phi) * Math.sin(lambda),
  );
}

const coord = (value: number, pos: string, neg: string) =>
  `${Math.abs(value).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}° ${value >= 0 ? pos : neg}`;

export const formatLat = (lat: number) => coord(lat, 'с. ш.', 'ю. ш.');
export const formatLon = (lon: number) => coord(lon, 'в. д.', 'з. д.');
