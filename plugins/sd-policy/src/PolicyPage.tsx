import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SectionFilterHeader, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchGatekeeperViolations, GatekeeperViolation } from './gatekeeperClient';
import { usePolicyType } from './hooks';
import { ClusterPolicyReport, PolicyReport, PolicyResult } from './policyResources';

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

function resultColor(result: string): 'error' | 'warning' | 'info' | 'default' {
  switch (result) {
    case 'fail':
    case 'deny':
      return 'error';
    case 'warn':
      return 'warning';
    case 'error':
    case 'dryrun':
      return 'info';
    default:
      return 'default';
  }
}

interface ViolationRow {
  policy: string;
  rule: string;
  result: string;
  message: string;
  category: string;
  resourceKind: string;
  resourceName: string;
  namespace: string;
}


function KyvernoView({
  allowedSet,
  selectedNs,
  namespacesLoaded,
}: {
  allowedSet: Set<string>;
  selectedNs: string[];
  namespacesLoaded: boolean;
}) {
  const [policyReports, prError] = PolicyReport.useList();
  const [clusterPolicyReports, cprError] = ClusterPolicyReport.useList();

  const violations = useMemo(() => {
    if (namespacesLoaded && allowedSet.size === 0) return [];

    const rows: ViolationRow[] = [];

    const isViolation = (r: PolicyResult) =>
      r.result === 'fail' || r.result === 'warn' || r.result === 'error';

    if (policyReports) {
      for (const report of policyReports) {
        const reportNs = report.metadata.namespace || '';

        if (allowedSet.size > 0 && !allowedSet.has(reportNs)) continue;
        if (selectedNs.length > 0 && !selectedNs.includes(reportNs)) continue;

        const scope = report.scope;

        for (const r of report.results) {
          if (!isViolation(r)) continue;

          rows.push({
            policy: r.policy,
            rule: r.rule,
            result: r.result,
            message: r.message,
            category: r.category || '',
            resourceKind: scope?.kind || '',
            resourceName: scope?.name || '',
            namespace: scope?.namespace || reportNs,
          });
        }
      }
    }

    if (clusterPolicyReports) {
      for (const report of clusterPolicyReports) {
        const scope = report.scope;
        const ns = scope?.namespace || '';

        if (ns && allowedSet.size > 0 && !allowedSet.has(ns)) continue;
        if (ns && selectedNs.length > 0 && !selectedNs.includes(ns)) continue;

        for (const r of report.results) {
          if (!isViolation(r)) continue;

          rows.push({
            policy: r.policy,
            rule: r.rule,
            result: r.result,
            message: r.message,
            category: r.category || '',
            resourceKind: scope?.kind || '',
            resourceName: scope?.name || '',
            namespace: ns,
          });
        }
      }
    }

    return rows;
  }, [policyReports, clusterPolicyReports, allowedSet, selectedNs]);

  const listError = prError || cprError;

  return { violations, loading: !policyReports && !clusterPolicyReports, error: listError };
}

function useGatekeeperView(
  allowedSet: Set<string>,
  selectedNs: string[],
  namespacesLoaded: boolean
): { violations: ViolationRow[]; loading: boolean; error: any } {
  const [rawViolations, setRawViolations] = useState<GatekeeperViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchGatekeeperViolations();

      setRawViolations(result);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const violations = useMemo(() => {
    if (namespacesLoaded && allowedSet.size === 0) return [];

    return rawViolations
      .filter(v => {
        if (v.namespace && allowedSet.size > 0 && !allowedSet.has(v.namespace)) return false;
        if (v.namespace && selectedNs.length > 0 && !selectedNs.includes(v.namespace)) return false;

        return true;
      })
      .map(v => ({
        policy: v.constraintKind,
        rule: v.constraintName,
        result: v.enforcementAction,
        message: v.message,
        category: '',
        resourceKind: v.kind,
        resourceName: v.name,
        namespace: v.namespace,
      }));
  }, [rawViolations, allowedSet, selectedNs]);

  return { violations, loading, error };
}

export default function PolicyPage() {
  const { policyType, loading: configLoading } = usePolicyType();
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const [selectedNs, setSelectedNs] = useState<string[]>([]);

  const policyEnabled = policyType !== '' && policyType !== 'none';
  const isKyverno = policyType === 'kyverno';
  const isGatekeeper = policyType === 'gatekeeper';

  const namespacesLoaded = namespaces !== null;

  const allowedNamespaces = useMemo(() => {
    if (!namespaces) return [] as string[];

    return namespaces.map((ns: any) => ns.metadata.name as string).sort();
  }, [namespaces]);

  const allowedSet = useMemo(() => new Set(allowedNamespaces), [allowedNamespaces]);

  const kyvernoData = KyvernoView({ allowedSet, selectedNs, namespacesLoaded });
  const gatekeeperData = useGatekeeperView(allowedSet, selectedNs, namespacesLoaded);

  const { violations, loading: dataLoading, error: dataError } = isGatekeeper
    ? gatekeeperData
    : kyvernoData;

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const v of violations) {
      counts[v.result] = (counts[v.result] || 0) + 1;
    }

    return { total: violations.length, counts };
  }, [violations]);

  if (configLoading) {
    return (
      <SectionBox title="SD Policy">
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      </SectionBox>
    );
  }

  if (!policyEnabled) {
    return (
      <SectionBox title="SD Policy">
        <Alert severity="info">
          Policy enforcement is not enabled in this cluster. Set <code>policy.type</code> to{' '}
          <code>kyverno</code> or <code>gatekeeper</code> to enable policy violations monitoring.
        </Alert>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="SD Policy"
          noNamespaceFilter
          actions={[
            <Autocomplete
              key="namespace-filter"
              multiple
              size="small"
              options={allowedNamespaces}
              value={selectedNs}
              onChange={(_, newValue) => setSelectedNs(newValue)}
              renderInput={params => (
                <TextField {...params} label="Namespaces" placeholder="Filter" />
              )}
              sx={{ minWidth: 200 }}
            />,
          ]}
        />
      }
    >
      {dataError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(dataError as any)?.message || 'Failed to fetch policy data'}
        </Alert>
      )}

      <Box display="flex" gap={2} sx={{ mb: 3 }}>
        <Box flex={1}>
          <StatCard title="Violations" value={stats.total} color="text.primary" />
        </Box>
        {isKyverno ? (
          <>
            <Box flex={1}>
              <StatCard title="Fail" value={stats.counts.fail || 0} color="error.main" />
            </Box>
            <Box flex={1}>
              <StatCard title="Warn" value={stats.counts.warn || 0} color="warning.main" />
            </Box>
            <Box flex={1}>
              <StatCard title="Error" value={stats.counts.error || 0} color="info.main" />
            </Box>
          </>
        ) : (
          <>
            <Box flex={1}>
              <StatCard title="Deny" value={stats.counts.deny || 0} color="error.main" />
            </Box>
            <Box flex={1}>
              <StatCard title="Warn" value={stats.counts.warn || 0} color="warning.main" />
            </Box>
            <Box flex={1}>
              <StatCard title="Dryrun" value={stats.counts.dryrun || 0} color="info.main" />
            </Box>
          </>
        )}
      </Box>

      <Table
        data={violations}
        loading={dataLoading}
        enableColumnFilters={false}
        columns={[
          {
            header: isKyverno ? 'Policy' : 'Constraint',
            accessorFn: (row: ViolationRow) => row.policy,
            gridTemplate: '1fr',
          },
          {
            header: isKyverno ? 'Rule' : 'Name',
            accessorFn: (row: ViolationRow) => row.rule,
            gridTemplate: '1fr',
          },
          {
            header: 'Result',
            accessorFn: (row: ViolationRow) => row.result,
            Cell: ({ cell }: any) => (
              <Chip label={cell.getValue()} size="small" color={resultColor(cell.getValue())} />
            ),
            gridTemplate: 'min-content',
          },
          {
            header: 'Resource',
            accessorFn: (row: ViolationRow) =>
              row.resourceKind ? `${row.resourceKind}/${row.resourceName}` : '-',
            gridTemplate: '1fr',
          },
          {
            header: 'Namespace',
            accessorFn: (row: ViolationRow) => row.namespace || '-',
            gridTemplate: '0.7fr',
          },
          ...(isKyverno
            ? [
                {
                  header: 'Category',
                  accessorFn: (row: ViolationRow) => row.category || '-',
                  gridTemplate: '1fr',
                },
              ]
            : []),
          {
            header: 'Message',
            accessorFn: (row: ViolationRow) => row.message,
            gridTemplate: '2fr',
          },
        ]}
        emptyMessage="No policy violations found."
      />
    </SectionBox>
  );
}
