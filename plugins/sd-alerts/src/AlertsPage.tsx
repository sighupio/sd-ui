import { SectionBox, SectionFilterHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMonitoringType, usePrometheusUrl } from './hooks';
import { AlertCategory, AlertInfo, fetchAlerts } from './prometheusAlerts';

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

function formatTime(isoString: string): string {
  if (!isoString) return '-';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);

  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);

  return `${diffDays}d ago`;
}

function AlertRow({ alert, prometheusUrl }: { alert: AlertInfo; prometheusUrl: string }) {
  const [expanded, setExpanded] = useState(false);

  const promLink = prometheusUrl
    ? `${prometheusUrl}/graph?g0.expr=ALERTS%7Balertname%3D%22${encodeURIComponent(alert.name)}%22%7D&g0.tab=1`
    : '';

  const importantLabels = Object.entries(alert.labels).filter(
    ([k]) => !['alertname', 'severity', 'category'].includes(k)
  );

  return (
    <>
      <TableRow
        hover
        onClick={() => setExpanded(!expanded)}
        sx={{ cursor: 'pointer', '& > *': { borderBottom: expanded ? 'none !important' : undefined } }}
      >
        <TableCell>
          <strong>{alert.name}</strong>
        </TableCell>
        <TableCell>
          <Chip
            label={alert.severity}
            size="small"
            color={alert.severity === 'critical' ? 'error' : 'warning'}
          />
        </TableCell>
        <TableCell sx={{ maxWidth: 400 }}>{alert.summary || alert.description}</TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatTime(alert.activeAt)}</TableCell>
        <TableCell>{alert.namespace}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={5} sx={{ py: 0, px: 2 }}>
          <Collapse in={expanded}>
            <Box sx={{ py: 2 }}>
              {alert.description && (
                <Box mb={1}>
                  <Typography variant="caption" color="text.secondary">
                    Description
                  </Typography>
                  <Typography variant="body2">{alert.description}</Typography>
                </Box>
              )}
              <Box mb={1}>
                <Typography variant="caption" color="text.secondary">
                  Labels
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={0.5} mt={0.5}>
                  {importantLabels.map(([k, v]) => (
                    <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
                  ))}
                </Box>
              </Box>
              <Box display="flex" gap={2} mt={1}>
                {promLink && (
                  <Link href={promLink} target="_blank" rel="noopener noreferrer" variant="body2">
                    View in Prometheus
                  </Link>
                )}
                {alert.runbookUrl && (
                  <Link
                    href={alert.runbookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="body2"
                  >
                    Runbook
                  </Link>
                )}
              </Box>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function AlertsPage() {
  const { monitoringType, isSso, loading: configLoading } = useMonitoringType();
  const prometheusUrl = usePrometheusUrl(isSso);
  const [categories, setCategories] = useState<AlertCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPrometheus =
    monitoringType === 'prometheus' ||
    monitoringType === 'prometheusAgent' ||
    monitoringType === 'mimir';

  const fetchData = useCallback(async () => {
    if (!hasPrometheus) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchAlerts();

      setCategories(result);
    } catch (err: any) {
      setError(err.message || 'Failed to query Prometheus');
    } finally {
      setLoading(false);
    }
  }, [hasPrometheus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stats = useMemo(() => {
    let critical = 0;
    let warning = 0;

    for (const cat of categories) {
      critical += cat.critical;
      warning += cat.warning;
    }

    return { total: critical + warning, critical, warning };
  }, [categories]);

  if (configLoading) {
    return (
      <SectionBox title="SD Alerts">
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      </SectionBox>
    );
  }

  if (!hasPrometheus) {
    return (
      <SectionBox title="SD Alerts">
        <Alert severity="info">
          Prometheus is not enabled in this cluster. Alerts require Prometheus.
        </Alert>
      </SectionBox>
    );
  }

  return (
    <SectionBox title={<SectionFilterHeader title="SD Alerts" noNamespaceFilter />}>
      <Alert severity="info" variant="outlined" sx={{ mb: 2 }} icon={false}>
        Unrestricted cluster-wide view
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box display="flex" gap={2} sx={{ mb: 3 }}>
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

      {loading ? (
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      ) : categories.length === 0 ? (
        <Alert severity="success">No firing alerts.</Alert>
      ) : (
        <Box pb={3}>
        {categories.map(cat => (
          <Accordion key={cat.name} defaultExpanded>
            <AccordionSummary>
              <Box display="flex" alignItems="center" gap={1} width="100%">
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', flexGrow: 1 }}>
                  {cat.name}
                </Typography>
                {cat.critical > 0 && (
                  <Chip label={`${cat.critical} critical`} size="small" color="error" />
                )}
                {cat.warning > 0 && (
                  <Chip label={`${cat.warning} warning`} size="small" color="warning" />
                )}
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Alert</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Summary</TableCell>
                    <TableCell>Since</TableCell>
                    <TableCell>Namespace</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cat.alerts.map((alert, idx) => (
                    <AlertRow
                      key={`${alert.name}-${idx}`}
                      alert={alert}
                      prometheusUrl={prometheusUrl}
                    />
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        ))}
        </Box>
      )}
    </SectionBox>
  );
}
