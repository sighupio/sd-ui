import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { LokiEvent } from './lokiClient';

const OS_PREFIX = 'logging/services/opensearch-cluster-master:9200';

function parseHit(hit: any): LokiEvent | null {
  try {
    const src = hit._source || {};

    // The event is JSON-encoded inside the "message" field (same as Loki)
    const parsed = JSON.parse(src.message || '{}');
    const event = parsed.event || parsed;

    return {
      timestamp:
        event.lastTimestamp ||
        event.firstTimestamp ||
        event.metadata?.creationTimestamp ||
        src['@timestamp'] ||
        '',
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

export async function queryOpenSearchEvents(
  from: number,
  to: number,
  limit: number = 1000
): Promise<LokiEvent[]> {
  const fromMs = from * 1000;
  const toMs = to * 1000;

  const body = JSON.stringify({
    size: limit,
    sort: [{ '@timestamp': { order: 'desc' } }],
    query: {
      range: {
        '@timestamp': {
          gte: fromMs,
          lte: toMs,
          format: 'epoch_millis',
        },
      },
    },
  });

  const url = `/api/v1/namespaces/${OS_PREFIX}/proxy/events-*/_search`;

  const response = await ApiProxy.request(url, {
    method: 'POST',
    body,
    isJSON: false,
    headers: { 'Content-Type': 'application/json' },
  } as any);

  if (response.status !== 200) {
    throw new Error(`OpenSearch query failed: ${response.statusText}`);
  }

  const data = await response.json();
  const hits = data.hits?.hits || [];
  const events: LokiEvent[] = [];

  for (const hit of hits) {
    const event = parseHit(hit);

    if (event) {
      events.push(event);
    }
  }

  return events;
}
