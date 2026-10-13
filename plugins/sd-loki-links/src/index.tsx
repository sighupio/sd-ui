import { registerDetailsViewSectionsProcessor } from '@kinvolk/headlamp-plugin/lib';
import { Button } from '@mui/material';
import React from 'react';
import { useDistroConfig, useGrafanaUrl, useOpenSearchDashboardsUrl } from './hooks';
import {
  buildDqlQuery,
  buildOpenSearchDiscoverUrl,
  extractPodLabels,
  resolveIndexPatternId,
} from './openSearchUrl';

const SUPPORTED_KINDS = ['Pod', 'Deployment', 'DaemonSet', 'StatefulSet', 'Namespace'];
const SECTION_ID = 'sd-loki-logs';

function buildLogQuery(kind: string, name: string, namespace: string): string {
  switch (kind) {
    case 'Pod':
      return `{namespace="${namespace}", pod="${name}"}`;
    case 'Deployment':
    case 'DaemonSet':
    case 'StatefulSet':
      return `{namespace="${namespace}", pod=~"${name}-.*"}`;
    case 'Namespace':
      return `{namespace="${name}"}`;
    default:
      return `{namespace="${namespace}"}`;
  }
}

function buildGrafanaExploreUrl(grafanaUrl: string, query: string): string {
  const panes = JSON.stringify({
    a: { datasource: 'Loki', queries: [{ refId: 'A', expr: query }] },
  });

  return `${grafanaUrl}/explore?schemaVersion=1&panes=${encodeURIComponent(panes)}`;
}

function LogLinkButton({ label, url }: { label: string; url: string }) {
  return (
    <Button
      variant="outlined"
      size="small"
      sx={{ ml: 2, mb: 1 }}
      startIcon={
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M14 3v2h3.59l-9.83 9.83l1.41 1.41L19 6.41V10h2V3m-2 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"
          />
        </svg>
      }
      onClick={() => window.open(url, '_blank')}
    >
      {label}
    </Button>
  );
}

function LogLinkSection({ resource, kind }: { resource: any; kind: string }) {
  const { loggingType, isSso, loading } = useDistroConfig();
  const grafanaUrl = useGrafanaUrl(isSso);
  const osdUrl = useOpenSearchDashboardsUrl(isSso);

  if (loading) return null;

  const name = resource?.jsonData?.metadata?.name || resource?.metadata?.name || '';
  const namespace = resource?.jsonData?.metadata?.namespace || resource?.metadata?.namespace || '';

  if (!name) return null;

  if (loggingType === 'loki') {
    if (!grafanaUrl) return null;

    const query = buildLogQuery(kind, name, namespace);

    return (
      <LogLinkButton
        label={`View ${kind} logs in Grafana`}
        url={buildGrafanaExploreUrl(grafanaUrl, query)}
      />
    );
  }

  if (loggingType === 'opensearch') {
    if (!osdUrl) return null;

    // A Namespace page carries no metadata.namespace, so its own name is the namespace.
    const logNamespace = kind === 'Namespace' ? name : namespace;
    const indexPatternId = resolveIndexPatternId(logNamespace, extractPodLabels(resource, kind));
    const dql = buildDqlQuery(kind, name, namespace);

    return (
      <LogLinkButton
        label={`View ${kind} logs in OpenSearch`}
        url={buildOpenSearchDiscoverUrl(osdUrl, indexPatternId, dql)}
      />
    );
  }

  return null;
}

registerDetailsViewSectionsProcessor(function addLogLinkSection(resource, sections) {
  if (!resource) return sections;

  const kind = resource?.jsonData?.kind || resource?.kind;

  if (!kind || !SUPPORTED_KINDS.includes(kind)) return sections;
  if (sections.findIndex(s => typeof s === 'object' && s !== null && 'id' in s && s.id === SECTION_ID) !== -1) return sections;

  const logLinkSection = {
    id: SECTION_ID,
    section: <LogLinkSection resource={resource} kind={kind} />,
  };

  if (sections.length > 1) {
    return [sections[0], sections[1], logLinkSection, ...sections.slice(2)];
  }

  return [logLinkSection, ...sections];
});
