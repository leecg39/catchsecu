import { channel } from "node:diagnostics_channel";

export type RouteTraceEvent = { method: string; pathname: string; status: number };

const apiRouteChannel = channel("catchsecu.api.route");

/** Publishes no data unless a test or diagnostic subscriber is active. */
export function publishRouteTrace(request: Request, status: number) {
  if (!apiRouteChannel.hasSubscribers) return;
  apiRouteChannel.publish({
    method: request.method.toUpperCase(),
    pathname: new URL(request.url).pathname,
    status,
  } satisfies RouteTraceEvent);
}
