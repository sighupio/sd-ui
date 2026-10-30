import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { buildModules, ModuleInfo } from './modules';
import {
  getModuleValue,
  SD_SPEC_CONFIGMAP_NAME,
  SD_SPEC_CONFIGMAP_NAMESPACE,
  SdLink,
  SdSpecResult,
  toSdSpecResult,
} from './sdSpec';

export type { ModuleInfo } from './modules';
export type { SdLink } from './sdSpec';

export interface KfdData {
  kfdVersion: string;
  modules: ModuleInfo[];
  links: SdLink[];
  clusterName: string;
  clusterKind: string;
  isSso: boolean;
  loading: boolean;
  permissionError: boolean;
  isSdCluster: boolean;
}

export function useSdSpec(): SdSpecResult {
  const [configMap, error] = K8s.ResourceClasses.ConfigMap.useGet(
    SD_SPEC_CONFIGMAP_NAME,
    SD_SPEC_CONFIGMAP_NAMESPACE
  );

  return toSdSpecResult(configMap, error);
}

export function useKfdData(): KfdData {
  const { spec, loading, permissionError } = useSdSpec();

  const notFound = { kfdVersion: '', modules: [], links: [], clusterName: '', clusterKind: '', isSso: false, loading: false, permissionError: false, isSdCluster: false };

  if (permissionError) {
    return { ...notFound, permissionError: true };
  }

  if (loading) {
    return { ...notFound, loading: true };
  }

  // ConfigMap not found or unreadable — not a SIGHUP Distribution cluster
  if (!spec) {
    return notFound;
  }

  return {
    kfdVersion: spec.distributionVersion || 'Unknown',
    modules: buildModules(spec.moduleVersions, spec.modules, spec.links),
    links: spec.links,
    clusterName: spec.cluster.name || 'Unknown',
    clusterKind: spec.cluster.kind || 'Unknown',
    isSso: getModuleValue(spec, 'auth.provider.type') === 'sso',
    loading: false,
    permissionError: false,
    isSdCluster: true,
  };
}
