import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

const PROM_PREFIX = 'monitoring/services/prometheus-k8s:9090';

export interface CertInfo {
  subjectCN: string;
  issuerCN: string;
  type: 'secret' | 'file' | 'kubeconfig';
  location: string;
  namespace: string;
  node: string;
  expiresAt: Date;
  daysLeft: number;
  status: 'expired' | 'critical' | 'warning' | 'ok';
}

interface PrometheusResult {
  metric: Record<string, string>;
  value: [number, string];
}

interface PrometheusResponse {
  status: string;
  data: {
    resultType: string;
    result: PrometheusResult[];
  };
}

function getCertType(metric: Record<string, string>): 'secret' | 'file' | 'kubeconfig' {
  if (metric.secret_name) return 'secret';
  if (metric.embedded_key) return 'kubeconfig';

  return 'file';
}

function getCertLocation(metric: Record<string, string>, type: string): string {
  if (type === 'secret') return metric.secret_name || '';
  if (type === 'kubeconfig') return `${metric.filepath} (${metric.embedded_key})`;

  return metric.filepath || metric.filename || '';
}


function getStatus(daysLeft: number): 'expired' | 'critical' | 'warning' | 'ok' {
  if (daysLeft <= 0) return 'expired';
  if (daysLeft <= 7) return 'critical';
  if (daysLeft <= 28) return 'warning';

  return 'ok';
}

async function queryPrometheus(query: string): Promise<PrometheusResult[]> {
  const params = new URLSearchParams();

  params.append('query', query);

  const url = `/api/v1/namespaces/${PROM_PREFIX}/proxy/api/v1/query?${params.toString()}`;

  const response = await ApiProxy.request(url, {
    method: 'GET',
    isJSON: false,
  });

  if (response.status !== 200) {
    throw new Error(`Prometheus query failed: ${response.statusText}`);
  }

  const data: PrometheusResponse = await response.json();

  if (data.status !== 'success') {
    throw new Error(`Prometheus returned status: ${data.status}`);
  }

  return data.data.result;
}

async function fetchPodToNodeMap(): Promise<Map<string, string>> {
  const results = await queryPrometheus('kube_pod_info{pod=~"x509-certificate-exporter-data-plane.*"}');
  const map = new Map<string, string>();

  for (const r of results) {
    if (r.metric.pod && r.metric.node) {
      map.set(r.metric.pod, r.metric.node);
    }
  }

  return map;
}

export async function fetchCertificates(): Promise<CertInfo[]> {
  const [certResults, podToNode] = await Promise.all([
    queryPrometheus('x509_cert_not_after'),
    fetchPodToNodeMap(),
  ]);

  const now = Date.now() / 1000;

  return certResults
    .map(r => {
      const expiresAtUnix = parseFloat(r.value[1]);
      const daysLeft = Math.floor((expiresAtUnix - now) / 86400);
      const type = getCertType(r.metric);
      const podName = r.metric.pod || '';

      return {
        subjectCN: r.metric.subject_CN || '',
        issuerCN: r.metric.issuer_CN || '',
        type,
        location: getCertLocation(r.metric, type),
        namespace: r.metric.secret_namespace || '',
        node: type !== 'secret' ? podToNode.get(podName) || '' : '',
        expiresAt: new Date(expiresAtUnix * 1000),
        daysLeft,
        status: getStatus(daysLeft),
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
