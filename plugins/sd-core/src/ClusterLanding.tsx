import { Icon } from '@iconify/react';
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SectionFilterHeader, TileChart } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Link as MuiLink,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KfdData, UsefulLink, useIngressLinks, useKfdData } from './hooks';

function OverviewCharts() {
  const [nodes] = K8s.ResourceClasses.Node.useList();
  const [pods] = K8s.ResourceClasses.Pod.useList();
  const [nodeMetrics, metricsError] = K8s.ResourceClasses.Node.useMetrics();
  const theme = useTheme();

  const noMetrics = metricsError?.status === 404 || metricsError?.status === 403;

  const nodeList = nodes || [];
  const podList = pods || [];

  // CPU chart
  let totalCpu = 0;
  let usedCpu = 0;

  nodeList.forEach((node: any) => {
    const capacity = node.jsonData?.status?.capacity;

    if (capacity) {
      totalCpu += parseInt(capacity.cpu || '0');
    }
  });

  if (nodeMetrics && !noMetrics) {
    nodeMetrics.forEach((metric: any) => {
      const cpuStr = metric.usage?.cpu || '0';

      if (cpuStr.endsWith('n')) {
        usedCpu += parseInt(cpuStr) / 1e9;
      } else if (cpuStr.endsWith('m')) {
        usedCpu += parseInt(cpuStr) / 1000;
      } else {
        usedCpu += parseFloat(cpuStr);
      }
    });
  }

  // Memory chart
  let totalMemGb = 0;
  let usedMemGb = 0;

  nodeList.forEach((node: any) => {
    const capacity = node.jsonData?.status?.capacity;

    if (capacity) {
      const memKi = parseInt((capacity.memory || '0').replace('Ki', ''));

      totalMemGb += memKi / (1024 * 1024);
    }
  });

  if (nodeMetrics && !noMetrics) {
    nodeMetrics.forEach((metric: any) => {
      const memStr = metric.usage?.memory || '0';

      if (memStr.endsWith('Ki')) {
        usedMemGb += parseInt(memStr) / (1024 * 1024);
      } else if (memStr.endsWith('Mi')) {
        usedMemGb += parseInt(memStr) / 1024;
      } else if (memStr.endsWith('Gi')) {
        usedMemGb += parseFloat(memStr);
      }
    });
  }

  const cpuPercent = totalCpu > 0 ? Math.round((usedCpu / totalCpu) * 1000) / 10 : 0;
  const memPercent = totalMemGb > 0 ? Math.round((usedMemGb / totalMemGb) * 1000) / 10 : 0;

  // Pods chart
  const runningPods = podList.filter((p: any) => p.jsonData?.status?.phase === 'Running').length;
  const totalPods = podList.length;
  const podsPercent = totalPods > 0 ? Math.round((runningPods / totalPods) * 1000) / 10 : 0;

  // Nodes chart
  const readyNodes = nodeList.filter((node: any) => {
    const conditions = node.jsonData?.status?.conditions || [];

    return conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
  }).length;
  const totalNodes = nodeList.length;
  const nodesPercent = totalNodes > 0 ? Math.round((readyNodes / totalNodes) * 1000) / 10 : 0;

  const chartFill = theme.palette.mode === 'dark' ? '#929191' : theme.palette.primary.main;

  return (
    <SectionBox title="Overview" py={2}>
      <Grid container justifyContent="flex-start" alignItems="stretch" spacing={4}>
        {!noMetrics && (
          <>
            <Grid item xs sx={{ maxWidth: '300px' }}>
              <TileChart
                title="CPU Usage"
                data={[{ name: 'used', value: cpuPercent, fill: chartFill }]}
                total={100}
                label={`${cpuPercent} %`}
                legend={`${usedCpu.toFixed(2)} / ${totalCpu} units`}
              />
            </Grid>
            <Grid item xs sx={{ maxWidth: '300px' }}>
              <TileChart
                title="Memory Usage"
                data={[{ name: 'used', value: memPercent, fill: chartFill }]}
                total={100}
                label={`${memPercent} %`}
                legend={`${usedMemGb.toFixed(2)} / ${totalMemGb.toFixed(2)} GB`}
              />
            </Grid>
          </>
        )}
        <Grid item xs sx={{ maxWidth: '300px' }}>
          <TileChart
            title="Pods"
            data={[{ name: 'running', value: podsPercent, fill: chartFill }]}
            total={100}
            label={`${podsPercent} %`}
            legend={`${runningPods} / ${totalPods} Running`}
          />
        </Grid>
        <Grid item xs sx={{ maxWidth: '300px' }}>
          <TileChart
            title="Nodes"
            data={[{ name: 'ready', value: nodesPercent, fill: chartFill }]}
            total={100}
            label={`${nodesPercent} %`}
            legend={`${readyNodes} / ${totalNodes} Ready`}
          />
        </Grid>
      </Grid>
    </SectionBox>
  );
}

function SdInfoSection({ kfdData, links }: { kfdData: KfdData; links: UsefulLink[] }) {
  const [nodes] = K8s.ResourceClasses.Node.useList();

  const nodeList = nodes || [];
  const cpNodes = nodeList.filter(
    (n: any) =>
      n.jsonData?.metadata?.labels?.['node-role.kubernetes.io/control-plane'] !== undefined
  );
  const workerNodes = nodeList.filter(
    (n: any) =>
      n.jsonData?.metadata?.labels?.['node-role.kubernetes.io/control-plane'] === undefined
  );

  let totalCPU = 0;
  let totalRAM = 0;
  let k8sVersion = '';
  let containerRuntime = '';
  let osImage = '';

  nodeList.forEach((node: any) => {
    const capacity = node.jsonData?.status?.capacity;

    if (capacity) {
      totalCPU += parseInt(capacity.cpu || '0');
      const memKi = parseInt((capacity.memory || '0').replace('Ki', ''));

      totalRAM += Math.round(memKi / 1048576);
    }

    if (!k8sVersion) {
      k8sVersion = node.jsonData?.status?.nodeInfo?.kubeletVersion || '';
    }

    if (!containerRuntime) {
      containerRuntime = node.jsonData?.status?.nodeInfo?.containerRuntimeVersion || '';
    }

    if (!osImage) {
      osImage = node.jsonData?.status?.nodeInfo?.osImage || '';
    }
  });

  return (
    <SectionBox title="SIGHUP Distribution">
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Cluster
              </Typography>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell><strong>Name</strong></TableCell>
                    <TableCell>{kfdData.clusterName}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Kind</strong></TableCell>
                    <TableCell>{kfdData.clusterKind}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Kubernetes</strong></TableCell>
                    <TableCell>{k8sVersion}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Control Plane</strong></TableCell>
                    <TableCell>{cpNodes.length} nodes</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Workers</strong></TableCell>
                    <TableCell>{workerNodes.length} nodes</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Total CPU</strong></TableCell>
                    <TableCell>{totalCPU} cores</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Total RAM</strong></TableCell>
                    <TableCell>{totalRAM} Gi</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>Container Runtime</strong></TableCell>
                    <TableCell>{containerRuntime}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><strong>OS</strong></TableCell>
                    <TableCell>{osImage}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card variant="outlined">
            <CardContent>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Typography variant="h6">SIGHUP Distribution</Typography>
                <Chip label={kfdData.kfdVersion} color="primary" size="small" />
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Module</strong></TableCell>
                      <TableCell><strong>Version</strong></TableCell>
                      <TableCell><strong>Status</strong></TableCell>
                      <TableCell><strong>Links</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {kfdData.modules.map(mod => {
                      const moduleLinks = links.filter(l => l.module === mod.name);

                      return (
                        <TableRow key={mod.name}>
                          <TableCell>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Icon icon={mod.icon} width={18} height={18} />
                              <span style={{ textTransform: 'capitalize' }}>{mod.name}</span>
                            </Box>
                          </TableCell>
                          <TableCell>
                            {mod.version && (
                              <Chip label={mod.version} size="small" variant="outlined" />
                            )}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={mod.active ? mod.type : 'none'}
                              size="small"
                              color={mod.active ? 'success' : 'default'}
                              variant={mod.active ? 'filled' : 'outlined'}
                            />
                          </TableCell>
                          <TableCell>
                            {moduleLinks.map(link => (
                              <MuiLink
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="caption"
                                sx={{ display: 'block' }}
                              >
                                {link.name || link.url}
                              </MuiLink>
                            ))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </SectionBox>
  );
}

const PROM_PREFIX = 'monitoring/services/prometheus-k8s:9090';

function StatCard({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
        <Typography variant="h4" color={color}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
}

function AlertsSummary() {
  const [stats, setStats] = useState({ total: 0, critical: 0, warning: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const url = `/api/v1/namespaces/${PROM_PREFIX}/proxy/api/v1/rules?type=alert`;
      const response = await ApiProxy.request(url, { method: 'GET', isJSON: false });

      if (response.status !== 200) return;

      const data = await response.json();

      if (data.status !== 'success') return;

      let critical = 0;
      let warning = 0;

      for (const group of data.data.groups) {
        for (const rule of group.rules) {
          if (!rule.alerts) continue;

          for (const alert of rule.alerts) {
            if (alert.state !== 'firing') continue;

            const sev = alert.labels?.severity || rule.labels?.severity || '';

            if (sev === 'critical') critical++;
            else if (sev === 'warning') warning++;
          }
        }
      }

      setStats({ total: critical + warning, critical, warning });
    } catch {
      // silently fail on landing page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return null;

  return (
    <SectionBox title={<SectionFilterHeader title={<Box display="inline-flex" alignItems="baseline" gap={1}>Alerts <Typography variant="caption" color="text.secondary">Unrestricted cluster-wide view</Typography></Box>} noNamespaceFilter actions={[<MuiLink key="link" href="/c/main/sd/alerts" variant="body2">View all</MuiLink>]} />}>
      <Box display="flex" gap={2}>
        <Box flex={1}>
          <StatCard title="Firing" value={stats.total} color="text.primary" />
        </Box>
        <Box flex={1}>
          <StatCard title="Critical" value={stats.critical} color="error.main" />
        </Box>
        <Box flex={1}>
          <StatCard title="Warning" value={stats.warning} color="warning.main" />
        </Box>
      </Box>
    </SectionBox>
  );
}

function CertsSummary() {
  const [stats, setStats] = useState({ total: 0, expired: 0, critical: 0, warning: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();

      params.append('query', 'x509_cert_not_after');

      const url = `/api/v1/namespaces/${PROM_PREFIX}/proxy/api/v1/query?${params.toString()}`;
      const response = await ApiProxy.request(url, { method: 'GET', isJSON: false });

      if (response.status !== 200) return;

      const data = await response.json();

      if (data.status !== 'success') return;

      const now = Date.now() / 1000;
      let expired = 0;
      let critical = 0;
      let warning = 0;

      for (const r of data.data.result) {
        const expiresAt = parseFloat(r.value[1]);
        const daysLeft = Math.floor((expiresAt - now) / 86400);

        if (daysLeft <= 0) expired++;
        else if (daysLeft <= 7) critical++;
        else if (daysLeft <= 28) warning++;
      }

      setStats({ total: data.data.result.length, expired, critical, warning });
    } catch {
      // silently fail on landing page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return null;

  return (
    <SectionBox title={<SectionFilterHeader title={<Box display="inline-flex" alignItems="baseline" gap={1}>Certificates <Typography variant="caption" color="text.secondary">Unrestricted cluster-wide view</Typography></Box>} noNamespaceFilter actions={[<MuiLink key="link" href="/c/main/sd/certificates" variant="body2">View all</MuiLink>]} />}>
      <Box display="flex" gap={2}>
        <Box flex={1}>
          <StatCard title="Total" value={stats.total} color="text.primary" />
        </Box>
        <Box flex={1}>
          <StatCard title="Expired" value={stats.expired} color="error.main" />
        </Box>
        <Box flex={1}>
          <StatCard title="Critical (< 7d)" value={stats.critical} color="warning.main" />
        </Box>
        <Box flex={1}>
          <StatCard title="Warning (< 28d)" value={stats.warning} color="warning.light" />
        </Box>
      </Box>
    </SectionBox>
  );
}

function BackupsSummary() {
  const [stats, setStats] = useState({ total: 0, completed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const response = await ApiProxy.request(
        '/apis/velero.io/v1/namespaces/kube-system/backups',
        { method: 'GET', isJSON: false }
      );

      if (response.status !== 200) return;

      const data = await response.json();
      const items = data.items || [];
      let completed = 0;
      let failed = 0;

      for (const item of items) {
        const phase = item.status?.phase || '';

        if (phase === 'Completed') completed++;
        if (phase === 'Failed' || phase === 'PartiallyFailed') failed++;
      }

      setStats({ total: items.length, completed, failed });
    } catch {
      // silently fail on landing page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return null;

  return (
    <SectionBox title={<SectionFilterHeader title={<Box display="inline-flex" alignItems="baseline" gap={1}>Backups <Typography variant="caption" color="text.secondary">Unrestricted cluster-wide view</Typography></Box>} noNamespaceFilter actions={[<MuiLink key="link" href="/c/main/sd/backups" variant="body2">View all</MuiLink>]} />}>
      <Box display="flex" gap={2}>
        <Box flex={1}>
          <StatCard title="Total" value={stats.total} color="text.primary" />
        </Box>
        <Box flex={1}>
          <StatCard title="Completed" value={stats.completed} color="success.main" />
        </Box>
        <Box flex={1}>
          <StatCard title="Failed" value={stats.failed} color="error.main" />
        </Box>
      </Box>
    </SectionBox>
  );
}

function PolicySummary({ policyType }: { policyType: string }) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const [stats, setStats] = useState({ total: 0, fail: 0, warn: 0 });
  const [loading, setLoading] = useState(true);

  const allowedNs = useMemo(() => {
    if (!namespaces) return new Set<string>();

    return new Set(namespaces.map((ns: any) => ns.metadata.name as string));
  }, [namespaces]);

  const fetchData = useCallback(async () => {
    // If namespaces loaded but empty, user has no access — show zeros
    if (namespaces && allowedNs.size === 0) {
      setStats({ total: 0, fail: 0, warn: 0 });
      setLoading(false);

      return;
    }

    try {
      let fail = 0;
      let warn = 0;

      if (policyType === 'kyverno') {
        // Kyverno: query PolicyReport CRDs
        for (const endpoint of [
          '/apis/wgpolicyk8s.io/v1alpha2/policyreports',
          '/apis/wgpolicyk8s.io/v1alpha2/clusterpolicyreports',
        ]) {
          try {
            const response = await ApiProxy.request(endpoint, { method: 'GET', isJSON: false });

            if (response.status !== 200) continue;

            const data = await response.json();

            for (const item of data.items || []) {
              const ns = item.metadata?.namespace || item.scope?.namespace || '';

              if (ns && allowedNs.size > 0 && !allowedNs.has(ns)) continue;

              for (const result of item.results || []) {
                if (result.result === 'fail') fail++;
                else if (result.result === 'warn') warn++;
              }
            }
          } catch {
            // skip
          }
        }
      } else if (policyType === 'gatekeeper') {
        // Gatekeeper: query constraint CRDs for violations
        try {
          const apiResponse = await ApiProxy.request(
            '/apis/constraints.gatekeeper.sh/v1beta1',
            { method: 'GET', isJSON: false }
          );

          if (apiResponse.status === 200) {
            const apiData = await apiResponse.json();
            const resources = (apiData.resources || []).filter(
              (r: any) => !r.name.includes('/')
            );

            for (const resource of resources) {
              try {
                const listResponse = await ApiProxy.request(
                  `/apis/constraints.gatekeeper.sh/v1beta1/${resource.name}`,
                  { method: 'GET', isJSON: false }
                );

                if (listResponse.status !== 200) continue;

                const listData = await listResponse.json();

                for (const item of listData.items || []) {
                  for (const v of item.status?.violations || []) {
                    const ns = v.namespace || '';

                    if (ns && allowedNs.size > 0 && !allowedNs.has(ns)) continue;

                    const action = v.enforcementAction || item.spec?.enforcementAction || 'deny';

                    if (action === 'deny') fail++;
                    else if (action === 'warn') warn++;
                  }
                }
              } catch {
                // skip
              }
            }
          }
        } catch {
          // skip
        }
      }

      setStats({ total: fail + warn, fail, warn });
    } catch {
      // silently fail on landing page
    } finally {
      setLoading(false);
    }
  }, [allowedNs, policyType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return null;

  return (
    <SectionBox title={<SectionFilterHeader title="Policy" noNamespaceFilter actions={[<MuiLink key="link" href="/c/main/sd/policy" variant="body2">View all</MuiLink>]} />}>
      <Box display="flex" gap={2}>
        <Box flex={1}>
          <StatCard title="Violations" value={stats.total} color="text.primary" />
        </Box>
        <Box flex={1}>
          <StatCard title={policyType === 'gatekeeper' ? 'Deny' : 'Fail'} value={stats.fail} color="error.main" />
        </Box>
        <Box flex={1}>
          <StatCard title="Warn" value={stats.warn} color="warning.main" />
        </Box>
      </Box>
    </SectionBox>
  );
}

export default function ClusterLanding() {
  const kfdData = useKfdData();
  const links = useIngressLinks(kfdData.isSso);

  // Still loading — show spinner
  if (kfdData.loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  // Not a SIGHUP Distribution cluster — show standard overview
  if (!kfdData.isSdCluster) {
    return <OverviewCharts />;
  }

  const drActive = kfdData.modules.some(m => m.name === 'dr' && m.active);
  const policyMod = kfdData.modules.find(m => m.name === 'policy');
  const policyActive = policyMod?.active || false;

  // SIGHUP Distribution cluster — show SD info + overview charts + summaries
  return (
    <Box pb={3}>
      <SdInfoSection kfdData={kfdData} links={links} />
      <OverviewCharts />
      <AlertsSummary />
      <CertsSummary />
      {drActive && <BackupsSummary />}
      {policyActive && <PolicySummary policyType={policyMod?.type || ''} />}
    </Box>
  );
}
