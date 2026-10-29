import { z } from 'zod';
import { meters } from '../dispatch/rules';
import {
  HttpTransport,
  IntegrationUnavailable,
  production,
  proxyAwareTransport,
} from './transport';
const point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const routePoints = z.array(point).min(2).max(21);
export type Coordinate = z.infer<typeof point>;
export interface RouteDistance {
  distanceMeters: number;
  durationSeconds: number | null;
  source: 'STRAIGHT_LINE_DEVELOPMENT' | 'GOOGLE_ROUTES';
}
export interface MapsAdapter {
  route(points: Coordinate[]): Promise<RouteDistance>;
}
export class StraightLineDevelopmentMaps implements MapsAdapter {
  async route(input: Coordinate[]): Promise<RouteDistance> {
    const points = routePoints.parse(input);
    let distanceMeters = 0;
    for (let index = 1; index < points.length; index++)
      distanceMeters += meters(points[index - 1]!, points[index]!);
    return { distanceMeters, durationSeconds: null, source: 'STRAIGHT_LINE_DEVELOPMENT' };
  }
}
const googleResponse = z.object({
  routes: z
    .array(
      z.object({
        distanceMeters: z.number().int().nonnegative().max(10000000),
        duration: z.string().regex(/^\d+(?:\.\d+)?s$/),
      }),
    )
    .min(1),
});
export class GoogleRoutesMaps implements MapsAdapter {
  constructor(
    private readonly key: string,
    private readonly transport: HttpTransport = proxyAwareTransport,
  ) {
    if (!key) throw new Error('Google Routes exige credencial configurada.');
  }
  async route(input: Coordinate[]): Promise<RouteDistance> {
    const points = routePoints.parse(input);
    const waypoint = (p: Coordinate) => ({ location: { latLng: p } });
    try {
      const response = await this.transport(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.key,
            'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
          },
          body: JSON.stringify({
            origin: waypoint(points[0]!),
            destination: waypoint(points[points.length - 1]!),
            intermediates: points.slice(1, -1).map(waypoint),
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
            languageCode: 'pt-BR',
            units: 'METRIC',
          }),
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('provider rejected');
      const route = googleResponse.parse(await response.json()).routes[0]!;
      const durationSeconds = Number.parseFloat(route.duration.slice(0, -1));
      if (!Number.isFinite(durationSeconds)) throw new Error('invalid duration');
      return { distanceMeters: route.distanceMeters, durationSeconds, source: 'GOOGLE_ROUTES' };
    } catch {
      // Do not silently substitute another pricing source or expose provider bodies/keys.
      throw new IntegrationUnavailable('Google Routes');
    }
  }
}
export function createMapsAdapter(env: NodeJS.ProcessEnv, transport?: HttpTransport): MapsAdapter {
  const provider = env.MAPS_PROVIDER ?? 'development';
  if (provider === 'development') {
    if (production(env))
      throw new Error(
        'Rotas em linha reta são exclusivas do desenvolvimento. Configure MAPS_PROVIDER=google.',
      );
    return new StraightLineDevelopmentMaps();
  }
  if (provider !== 'google') throw new Error('MAPS_PROVIDER inválido.');
  return new GoogleRoutesMaps(env.GOOGLE_MAPS_API_KEY ?? '', transport);
}
