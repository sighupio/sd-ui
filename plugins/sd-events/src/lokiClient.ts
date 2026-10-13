import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

const LOKI_PREFIX = 'logging/services/loki-stack:3100';

export interface LokiEvent {
  timestamp: string;
  namespace: string;
  kind: string;
  name: string;
  reason: string;
  message: string;
  type: string;
  sourceComponent: string;
}

interface LokiQueryRangeResponse {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      stream: Record<string, string>;
      values: Array<[string, string]>;
    }>;
  };
}

function parseEventFromLog(logLine: string, lokiTimestampNs: string): LokiEvent | null {
  try {
    const entry = JSON.parse(logLine);

    // The actual K8s event is JSON-encoded inside the "message" field
    const innerJson = JSON.parse(entry.message || '{}');
    const event = innerJson.event || innerJson;

    // Use Loki timestamp (nanoseconds) as primary, fallback to event timestamps
    const tsMs = Math.floor(parseInt(lokiTimestampNs) / 1e6);
    const lokiDate = new Date(tsMs).toISOString();
    const eventTimestamp =
      event.lastTimestamp || event.firstTimestamp || event.metadata?.creationTimestamp || '';

    return {
      timestamp: eventTimestamp || lokiDate,
      namespace: event.involvedObject?.namespace || event.metadata?.namespace || '',
      kind: event.involvedObject?.kind || '',
      name: event.involvedObject?.name || '',
      reason: event.reason || '',
      message: event.message || '',
      type: event.type || 'Normal',
      sourceComponent: event.source?.component || event.reportingComponent || '',
    };
  } catch {
    return null;
  }
}

export async function queryLokiEvents(
  from: number,
  to: number,
  limit: number = 1000
): Promise<LokiEvent[]> {
  const query = '{flow="events"}';

  const params = new URLSearchParams();

  params.append('query', query);
  params.append('start', (from * 1e9).toString());
  params.append('end', (to * 1e9).toString());
  params.append('limit', limit.toString());
  params.append('direction', 'backward');

  const url = `/api/v1/namespaces/${LOKI_PREFIX}/proxy/loki/api/v1/query_range?${params.toString()}`;

  const response = await ApiProxy.request(url, {
    method: 'GET',
    isJSON: false,
  });

  if (response.status !== 200) {
    throw new Error(`Loki query failed: ${response.statusText}`);
  }

  const data: LokiQueryRangeResponse = await response.json();

  if (data.status !== 'success') {
    throw new Error(`Loki query returned status: ${data.status}`);
  }

  const events: LokiEvent[] = [];

  for (const stream of data.data.result) {
    for (const [tsNs, logLine] of stream.values) {
      const event = parseEventFromLog(logLine, tsNs);

      if (event) {
        events.push(event);
      }
    }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return events;
}
