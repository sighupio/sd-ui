export interface UsefulLink {
  name: string;
  url: string;
  module: string;
}

export interface IngressLocation {
  name: string;
  namespace: string;
}

// Known infrastructure ingresses exposed in Forecastle, mirroring the templates in
// distribution/templates/distribution/manifests/<module>/resources/*ingress*.yml.tpl.
// `sso` is where the ingress lives when it is protected by Pomerium, `noSso` when the
// auth provider is not SSO or the ingress has `disableAuth` set. When an ingress is
// never moved behind Pomerium, `sso` is omitted.
export interface IngressDef {
  displayName: string;
  module: string;
  sso?: IngressLocation;
  noSso: IngressLocation;
}

export const INGRESS_DEFS: IngressDef[] = [
  { displayName: 'Grafana', module: 'monitoring', sso: { name: 'grafana', namespace: 'pomerium' }, noSso: { name: 'grafana', namespace: 'monitoring' } },
  { displayName: 'Prometheus', module: 'monitoring', sso: { name: 'prometheus', namespace: 'pomerium' }, noSso: { name: 'prometheus', namespace: 'monitoring' } },
  { displayName: 'Alertmanager', module: 'monitoring', sso: { name: 'alertmanager', namespace: 'pomerium' }, noSso: { name: 'alertmanager', namespace: 'monitoring' } },
  { displayName: 'MinIO', module: 'monitoring', sso: { name: 'minio-monitoring', namespace: 'pomerium' }, noSso: { name: 'minio', namespace: 'monitoring' } },
  { displayName: 'OpenSearch Dashboards', module: 'logging', sso: { name: 'opensearch-dashboards', namespace: 'pomerium' }, noSso: { name: 'opensearch-dashboards', namespace: 'logging' } },
  { displayName: 'MinIO', module: 'logging', sso: { name: 'minio-logging', namespace: 'pomerium' }, noSso: { name: 'minio', namespace: 'logging' } },
  { displayName: 'MinIO', module: 'tracing', sso: { name: 'minio-tracing', namespace: 'pomerium' }, noSso: { name: 'minio', namespace: 'tracing' } },
  { displayName: 'Hubble UI', module: 'networking', sso: { name: 'hubble', namespace: 'pomerium' }, noSso: { name: 'hubble', namespace: 'kube-system' } },
  { displayName: 'Whisker', module: 'networking', sso: { name: 'whisker', namespace: 'pomerium' }, noSso: { name: 'whisker', namespace: 'calico-system' } },
  { displayName: 'Gatekeeper Policy Manager', module: 'policy', sso: { name: 'gpm', namespace: 'pomerium' }, noSso: { name: 'gpm', namespace: 'gatekeeper-system' } },
  { displayName: 'Forecastle', module: 'ingress', sso: { name: 'forecastle', namespace: 'pomerium' }, noSso: { name: 'forecastle', namespace: 'forecastle' } },
  { displayName: 'Gangplank', module: 'auth', noSso: { name: 'gangplank', namespace: 'kube-system' } },
];

export function extractHost(ingress: any): string {
  const rules = ingress?.jsonData?.spec?.rules;

  if (rules && rules.length > 0 && rules[0].host) {
    return rules[0].host;
  }

  return '';
}

export interface FetchedIngress {
  sso?: any;
  noSso?: any;
}

// Builds the links from the fetched ingresses (same order as `defs`). The location
// matching the cluster auth mode is preferred; the other one is used as a fallback,
// since a single ingress can opt out of SSO via `disableAuth`.
export function buildIngressLinks(defs: IngressDef[], fetched: FetchedIngress[], isSso: boolean): UsefulLink[] {
  const links: UsefulLink[] = [];

  defs.forEach((def, i) => {
    const { sso, noSso } = fetched[i] ?? {};
    const host = isSso ? extractHost(sso) || extractHost(noSso) : extractHost(noSso) || extractHost(sso);

    if (host) {
      links.push({ name: def.displayName, url: `https://${host}`, module: def.module });
    }
  });

  return links;
}
