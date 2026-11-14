import type { Env } from './env';
import { errorResponse, HttpError } from './http';
import { marketsRoutes } from './routes/markets';
import { roomsRoutes } from './routes/rooms';

export { TradingRoom } from './room';

export default {
  async fetch(request: Request, env: Env) {
    try {
      const url = new URL(request.url);
      const socket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
      if ((request.headers.get('Sec-Fetch-Site') === 'cross-site' && !(socket && request.headers.has('Sec-WebSocket-Protocol'))) ||
        ((request.method !== 'GET' || socket) && (!env.APP_ORIGIN || request.headers.get('Origin') !== env.APP_ORIGIN))) {
        throw new HttpError(403, 'Invalid request origin.');
      }
      const response = await marketsRoutes(request, env, url) ?? await roomsRoutes(request, env, url);
      if (!response) throw new HttpError(404, 'This endpoint is unavailable.');
      return response;
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
