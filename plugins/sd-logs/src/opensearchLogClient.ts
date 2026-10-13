import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { LogEntry } from './lokiLogClient';

const OS_PREFIX = 'logging/services/opensearch-cluster-master:9200';

export async function queryOpenSearchLogs(
  namespace: string,
  pod?: string,
  container?: string,
  from?: number,
  to?: number,
  limit: number = 1000
): Promise<LogEntry[]> {
  const now = to || Math.floor(Date.now() / 1000);
  const start = from || now - 3600;

  const must: any[] = [
    { range: { '@timestamp': { gte: start * 1000, lte: now * 1000, format: 'epoch_millis' } } },
    { term: { 'kubernetes.namespace_name.keyword': namespace } },
  ];

  if (pod) {
    if (pod.includes('|')) {
      // Multiple pods — use terms with .keyword (pod_name is analyzed, term won't match)
      must.push({ terms: { 'kubernetes.pod_name.keyword': pod.split('|') } });
    } else {
      must.push({ term: { 'kubernetes.pod_name.keyword': pod } });
    }
  }

  if (container) {
    must.push({ term: { 'kubernetes.container_name.keyword': container } });
  }

  const body = JSON.stringify({
    size: limit,
    sort: [{ '@timestamp': { order: 'asc' } }],
    query: { bool: { must } },
    _source: ['@timestamp', 'message', 'log', 'kubernetes'],
  });

  const url = `/api/v1/namespaces/${OS_PREFIX}/proxy/kubernetes-*,infra-*/_search`;

  const response = await ApiProxy.request(url, {
    method: 'POST',
    body,
    isJSON: false,
    headers: { 'Content-Type': 'application/json' },
  } as any);

  if (response.status !== 200) {
    throw new Error(`OpenSearch log query failed: ${response.statusText}`);
  }

  const data = await response.json();
  const hits = data.hits?.hits || [];

  return hits.map((hit: any) => {
    const src = hit._source || {};
    const ts = src['@timestamp'] ? new Date(src['@timestamp']).getTime() : 0;
    // message field may contain JSON with the actual log inside
    let line = src.message || src.log || JSON.stringify(src);

    try {
      const parsed = JSON.parse(line);

      line = parsed.message || parsed.log || line;
    } catch {
      // Not JSON — use as-is
    }

    const pod = src.kubernetes?.pod_name || '';
    const container = src.kubernetes?.container_name || '';

    return { ts, line, pod, container };
  });
}
