import { SectionBox, SectionFilterHeader, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMonitoringType } from './hooks';
import { CertInfo, fetchCertificates } from './prometheusClient';

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

export default function CertificatesPage() {
  const { monitoringType, loading: configLoading } = useMonitoringType();
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');

  const hasPrometheus = monitoringType === 'prometheus' || monitoringType === 'prometheusAgent' || monitoringType === 'mimir';


  const fetchData = useCallback(async () => {
    if (!hasPrometheus) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchCertificates();

      setCerts(result);
    } catch (err: any) {
      setError(err.message || 'Failed to query Prometheus');
    } finally {
      setLoading(false);
    }
  }, [hasPrometheus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredCerts = useMemo(() => {
    if (!typeFilter) return certs;

    return certs.filter(c => c.type === typeFilter);
  }, [certs, typeFilter]);

  const stats = useMemo(() => {
    const total = certs.length;
    const expired = certs.filter(c => c.status === 'expired').length;
    const critical = certs.filter(c => c.status === 'critical').length;
    const warning = certs.filter(c => c.status === 'warning').length;

    return { total, expired, critical, warning };
  }, [certs]);

  if (configLoading) {
    return (
      <SectionBox title="SD Certificates">
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      </SectionBox>
    );
  }

  if (!hasPrometheus) {
    return (
      <SectionBox title="SD Certificates">
        <Alert severity="info">
          Prometheus is not enabled in this cluster. Certificate monitoring requires Prometheus.
        </Alert>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="SD Certificates"
          noNamespaceFilter
          actions={[
            <FormControl size="small" sx={{ minWidth: 140 }} key="type-filter">
              <InputLabel>Type</InputLabel>
              <Select value={typeFilter} label="Type" onChange={e => setTypeFilter(e.target.value)}>
                <MenuItem value="">All</MenuItem>
                <MenuItem value="secret">Secrets</MenuItem>
                <MenuItem value="file">Files</MenuItem>
                <MenuItem value="kubeconfig">Kubeconfig</MenuItem>
              </Select>
            </FormControl>,
          ]}
        />
      }
    >
      <Alert severity="info" variant="outlined" sx={{ mb: 2 }} icon={false}>
        Unrestricted cluster-wide view
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <StatCard title="Total" value={stats.total} color="text.primary" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard title="Expired" value={stats.expired} color="error.main" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard title="Critical (< 7d)" value={stats.critical} color="warning.main" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCard title="Warning (< 28d)" value={stats.warning} color="warning.light" />
        </Grid>
      </Grid>

      <Table
        data={filteredCerts}
        loading={loading}
        enableColumnFilters={false}
        columns={[
          {
            header: 'Name/Location',
            accessorFn: (cert: CertInfo) => cert.location,
            gridTemplate: '1.5fr',
          },
          {
            header: 'Namespace',
            accessorFn: (cert: CertInfo) => cert.namespace || '-',
            gridTemplate: 'min-content',
          },
          {
            header: 'Type',
            accessorFn: (cert: CertInfo) => cert.type,
            gridTemplate: 'min-content',
          },
          {
            header: 'Node',
            accessorFn: (cert: CertInfo) => cert.node || '-',
            gridTemplate: 'min-content',
          },
          {
            header: 'Issuer',
            accessorFn: (cert: CertInfo) => cert.issuerCN,
            gridTemplate: '1fr',
          },
          {
            header: 'Expires',
            accessorFn: (cert: CertInfo) => cert.expiresAt.toLocaleDateString(),
            gridTemplate: 'min-content',
          },
          {
            header: 'Days Left',
            accessorFn: (cert: CertInfo) => cert.daysLeft,
            gridTemplate: 'min-content',
          },
          {
            header: 'Status',
            accessorFn: (cert: CertInfo) => cert.status,
            gridTemplate: 'min-content',
          },
        ]}
        emptyMessage="No certificates found"
        errorMessage={error || undefined}
      />
    </SectionBox>
  );
}
