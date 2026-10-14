import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

const LOKI_PREFIX = 'logging/services/loki-stack:3100';

interface LokiLabelResponse {
  status: string;
  data: string[];
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

export async function fetchLokiLabelValues(
  labelName: string,
  filterSelector?: string
): Promise<string[]> {
  const params = new URLSearchParams();

  if (filterSelector) {
    params.append('query', filterSelector);
  }

  const qs = params.toString() ? `?${params.toString()}` : '';
  const url = `/api/v1/namespaces/${LOKI_PREFIX}/proxy/loki/api/v1/label/${labelName}/values${qs}`;

  const response = await ApiProxy.request(url, { method: 'GET', isJSON: false });

  if (response.status !== 200) {
    throw new Error(`Loki label query failed: ${response.statusText}`);
  }

  const data: LokiLabelResponse = await response.json();

  if (data.status !== 'success') {
    throw new Error(`Loki label query returned status: ${data.status}`);
  }

  return data.data.sort();
}

export interface LogEntry {
  ts: number;
  line: string;
  pod: string;
  container: string;
}

export async function queryLokiLogs(
  namespace: string,
  pod?: string,
  container?: string,
  from?: number,
  to?: number,
  limit: number = 1000
): Promise<LogEntry[]> {
  let selector = `namespace="${namespace}", flow!="events"`;

  if (pod) {
    // Support regex patterns (e.g., "pod1|pod2|pod3")
    if (pod.includes('|')) {
      selector += `, pod=~"${pod}"`;
    } else {
      selector += `, pod="${pod}"`;
    }
  }

  if (container) selector += `, container="${container}"`;

  const query = `{${selector}}`;
  const params = new URLSearchParams();

  params.append('query', query);
  params.append('limit', limit.toString());
  params.append('direction', 'backward');

  const now = to || Math.floor(Date.now() / 1000);
  const start = from || now - 3600;

  params.append('start', (start * 1e9).toString());
  params.append('end', (now * 1e9).toString());

  const url = `/api/v1/namespaces/${LOKI_PREFIX}/proxy/loki/api/v1/query_range?${params.toString()}`;

  const response = await ApiProxy.request(url, { method: 'GET', isJSON: false });

  if (response.status !== 200) {
    throw new Error(`Loki log query failed: ${response.statusText}`);
  }

  const data: LokiQueryRangeResponse = await response.json();

  if (data.status !== 'success') {
    throw new Error(`Loki log query returned status: ${data.status}`);
  }

  const lines: LogEntry[] = [];

  for (const stream of data.data.result) {
    const podName = stream.stream.pod || '';
    const containerName = stream.stream.container || '';

    for (const [tsNs, logLine] of stream.values) {
      const tsMs = Math.floor(parseInt(tsNs) / 1e6);

      // Raw line is JSON: {"time":"...","stream":"...","message":"actual log"}
      // Extract just the message field
      let msg = logLine;

      try {
        const parsed = JSON.parse(logLine);

        msg = parsed.message || parsed.log || logLine;
      } catch {
        // Not JSON — use raw line
      }

      lines.push({ ts: tsMs, line: msg, pod: podName, container: containerName });
    }
  }

  // Sort chronologically (oldest first for terminal display)
  lines.sort((a, b) => a.ts - b.ts);

  return lines;
}
