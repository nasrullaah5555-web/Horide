import { haversineMetres, type LatLng } from '../../common/geo';

export interface Route {
  distanceMetres: number;
  durationSeconds: number;
  /** true when this is NOT a real road route (development estimate). Shown to users and stored on trips. */
  isEstimate: boolean;
}

/** Road-route distance and time between two points (requirement FR-02). */
export interface RoutingProvider {
  route(from: LatLng, to: LatLng): Promise<Route>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');

/** Typical ratio of road distance to straight-line distance in a small city. A rough assumption. */
const ROAD_FACTOR = 1.3;
const AVERAGE_SPEED_KMH = 25;

/**
 * DEVELOPMENT/TEST ONLY: straight-line distance × 1.3. Always marked isEstimate.
 * Production configuration refuses this provider, because fares must use real road distance.
 */
export class StraightLineEstimateRouting implements RoutingProvider {
  async route(from: LatLng, to: LatLng): Promise<Route> {
    const distanceMetres = Math.round(haversineMetres(from, to) * ROAD_FACTOR);
    return {
      distanceMetres,
      durationSeconds: Math.round((distanceMetres / 1000 / AVERAGE_SPEED_KMH) * 3600),
      isEstimate: true,
    };
  }
}

/**
 * Real routing providers. Not implemented until the provider is chosen and an API key / server
 * exists to test against (owner action OA-09). The API refuses to start in production without one.
 */
export class NotConfiguredRouting implements RoutingProvider {
  constructor(private readonly name: string) {
    throw new Error(
      `Routing provider "${name}" is not implemented yet (blocked by owner action OA-09).`,
    );
  }
  async route(): Promise<Route> {
    throw new Error('not implemented');
  }
}
