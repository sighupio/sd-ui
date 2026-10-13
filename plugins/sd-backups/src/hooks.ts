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

export function useDrType(): { drType: string; loading: boolean } {
  const { spec, loading } = useSdSpec();

  return {
    drType: getModuleValue(spec, 'dr.type'),
    loading,
  };
}
