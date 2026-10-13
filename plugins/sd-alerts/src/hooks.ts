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

export function useMonitoringType(): { monitoringType: string; isSso: boolean; loading: boolean } {
  const { spec, loading } = useSdSpec();

  return {
    monitoringType: getModuleValue(spec, 'monitoring.type'),
    isSso: getModuleValue(spec, 'auth.provider.type') === 'sso',
    loading,
  };
}

export function usePrometheusUrl(isSso: boolean): string {
  const [promSso] = K8s.ResourceClasses.Ingress.useGet('prometheus', 'pomerium');
  const [promNoSso] = K8s.ResourceClasses.Ingress.useGet('prometheus', 'monitoring');

  const ingress = isSso ? promSso : promNoSso;
  const rules = ingress?.jsonData?.spec?.rules;

  if (rules && rules.length > 0 && rules[0].host) {
    return `https://${rules[0].host}`;
  }

  return '';
}
