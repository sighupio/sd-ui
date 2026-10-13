import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  getModuleValue,
  SD_SPEC_CONFIGMAP_NAME,
  SD_SPEC_CONFIGMAP_NAMESPACE,
  SdSpecResult,
  toSdSpecResult,
} from './sdSpec';

export function useSdSpec(): SdSpecResult {
  const [configMap, error] = K8s.ResourceClasses.ConfigMap.useGet(
    SD_SPEC_CONFIGMAP_NAME,
    SD_SPEC_CONFIGMAP_NAMESPACE
  );

  return toSdSpecResult(configMap, error);
}

export function useDistroConfig(): { loggingType: string; isSso: boolean; loading: boolean } {
  const { spec, loading } = useSdSpec();

  return {
    loggingType: getModuleValue(spec, 'logging.type'),
    isSso: getModuleValue(spec, 'auth.provider.type') === 'sso',
    loading,
  };
}

function extractHostUrl(ingress: any): string {
  const rules = ingress?.jsonData?.spec?.rules;

  if (rules && rules.length > 0 && rules[0].host) {
    return `https://${rules[0].host}`;
  }

  return '';
}

export function useGrafanaUrl(isSso: boolean): string {
  const [grafanaSso] = K8s.ResourceClasses.Ingress.useGet('grafana', 'pomerium');
  const [grafanaNoSso] = K8s.ResourceClasses.Ingress.useGet('grafana', 'monitoring');

  return extractHostUrl(isSso ? grafanaSso : grafanaNoSso);
}

export function useOpenSearchDashboardsUrl(isSso: boolean): string {
  const [osdSso] = K8s.ResourceClasses.Ingress.useGet('opensearch-dashboards', 'pomerium');
  const [osdNoSso] = K8s.ResourceClasses.Ingress.useGet('opensearch-dashboards', 'logging');

  return extractHostUrl(isSso ? osdSso : osdNoSso);
}
