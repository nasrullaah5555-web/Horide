import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';

/** A coordinate from a client. Rounded to ~1 m (6 decimals) — more precision is noise. */
export const latLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90).transform(round6),
  lng: z.number().min(-180).max(180).transform(round6),
});
export type LatLng = z.infer<typeof latLngSchema>;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** SQL for a geography point. Values are bound parameters, never pasted into the SQL text. */
export function geoPoint(p: LatLng): RawBuilder<unknown> {
  return sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
}

/** Selects a geography column back as numbers: lat and lng. */
export function latOf(column: string): RawBuilder<number> {
  return sql<number>`ST_Y(${sql.ref(column)}::geometry)`;
}
export function lngOf(column: string): RawBuilder<number> {
  return sql<number>`ST_X(${sql.ref(column)}::geometry)`;
}

/** Great-circle distance in metres (used only for development estimates and sanity checks). */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
