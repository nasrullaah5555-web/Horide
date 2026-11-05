'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { colors } from '@/lib/tokens.g';

export interface MapDriver {
  driver_id: string;
  full_name: string | null;
  plate_number: string | null;
  category: string | null;
  lat: number;
  lng: number;
  age_seconds: number;
  isLive: boolean;
  on_trip: boolean;
}

export interface MapZone {
  name: string;
  active: boolean;
  geojson: GeoJSON.Polygon;
}

const JIJIGA: L.LatLngExpression = [9.35, 42.8];

/** Colours: sign green = free and live, navy = on a ride, grey = position is stale. */
function style(d: MapDriver): L.CircleMarkerOptions {
  const colour = !d.isLive ? colors.stale : d.on_trip ? colors.navy : colors.sign;
  return { radius: 8, color: colors.white, weight: 2, fillColor: colour, fillOpacity: 1 };
}

/**
 * OpenStreetMap tiles via Leaflet. OSM's public tile servers are for light use only; production
 * traffic needs a tile provider that permits it (OWNER_ACTION_REGISTER OA-20).
 */
export default function LiveMap({
  drivers = [],
  zones = [],
  height = 560,
}: {
  drivers?: MapDriver[];
  zones?: MapZone[];
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { center: JIJIGA, zoom: 14, scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    const zoneBounds = L.latLngBounds([]);
    for (const z of zones) {
      const shape = L.geoJSON(z.geojson, {
        style: {
          color: z.active ? colors.sign : colors.stale,
          weight: 2,
          fillOpacity: 0.05,
          dashArray: z.active ? undefined : '6 6',
        },
      })
        .bindTooltip(`${z.name}${z.active ? '' : ' (inactive)'}`)
        .addTo(group);
      zoneBounds.extend(shape.getBounds());
    }
    // Show the whole service area once, then leave the view to the user.
    if (!fitted.current && zoneBounds.isValid()) {
      map.current?.fitBounds(zoneBounds, { padding: [20, 20] });
      fitted.current = true;
    }
    for (const d of drivers) {
      const label = `${d.full_name ?? 'Driver'}${d.plate_number ? `, ${d.plate_number}` : ''}`;
      const status = d.on_trip ? 'on a ride' : 'available';
      const freshness = d.isLive ? 'live' : `last seen ${d.age_seconds}s ago`;
      L.circleMarker([d.lat, d.lng], style(d))
        .bindTooltip(`${label}: ${status}, ${freshness}`)
        .addTo(group);
    }
  }, [drivers, zones]);

  return (
    <div
      ref={el}
      style={{ height }}
      className="w-full overflow-hidden rounded-control ring-1 ring-line"
      role="application"
      aria-label="Map of Jijiga"
    />
  );
}
