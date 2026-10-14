import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

const PROM_PREFIX = 'monitoring/services/prometheus-k8s:9090';

export interface AlertInfo {
  name: string;
  severity: string;
  description: string;
  summary: string;
  runbookUrl: string;
  state: string;
  activeAt: string;
  namespace: string;
  instance: string;
  group: string;
  labels: Record<string, string>;
}

export interface AlertCategory {
  name: string;
  critical: number;
  warning: number;
  alerts: AlertInfo[];
}

interface PrometheusRulesResponse {
  status: string;
  data: {
    groups: Array<{
      name: string;
      rules: Array<{
        name: string;
        state: string;
        labels: Record<string, string>;
        annotations: Record<string, string>;
        alerts: Array<{
          labels: Record<string, string>;
          annotations: Record<string, string>;
          state: string;
          activeAt: string;
          value: string;
        }>;
      }>;
    }>;
  };
}

export async function fetchAlerts(): Promise<AlertCategory[]> {
  const url = `/api/v1/namespaces/${PROM_PREFIX}/proxy/api/v1/rules?type=alert`;

  const response = await ApiProxy.request(url, {
    method: 'GET',
    isJSON: false,
  });

  if (response.status !== 200) {
    throw new Error(`Prometheus query failed: ${response.statusText}`);
  }

  const data: PrometheusRulesResponse = await response.json();

  if (data.status !== 'success') {
    throw new Error(`Prometheus returned status: ${data.status}`);
  }

  const categoryMap = new Map<string, AlertInfo[]>();

  for (const group of data.data.groups) {
    for (const rule of group.rules) {
      if (!rule.alerts) continue;

      for (const alert of rule.alerts) {
        if (alert.state !== 'firing') continue;

        const severity = alert.labels.severity || rule.labels.severity || '';

        if (severity !== 'critical' && severity !== 'warning') continue;

        const info: AlertInfo = {
          name: alert.labels.alertname || rule.name || '',
          severity,
          description: alert.annotations?.description || rule.annotations?.description || '',
          summary: alert.annotations?.summary || rule.annotations?.summary || '',
          runbookUrl: alert.annotations?.runbook_url || rule.annotations?.runbook_url || '',
          state: alert.state,
          activeAt: alert.activeAt || '',
          namespace: alert.labels.namespace || '',
          instance: alert.labels.instance || '',
          group: group.name,
          labels: alert.labels,
        };

        const existing = categoryMap.get(group.name) || [];

        existing.push(info);
        categoryMap.set(group.name, existing);
      }
    }
  }

  return Array.from(categoryMap.entries())
    .map(([name, alerts]) => {
      alerts.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;

        return new Date(b.activeAt).getTime() - new Date(a.activeAt).getTime();
      });

      return {
        name,
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        alerts,
      };
    })
    .sort((a, b) => b.critical - a.critical || b.warning - a.warning);
}
