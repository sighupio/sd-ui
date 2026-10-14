import { SectionBox, SectionFilterHeader, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Card, CardContent, Chip, CircularProgress, Typography } from '@mui/material';
import React, { useMemo } from 'react';
import { useDrType } from './hooks';
import { Backup, Restore, Schedule } from './veleroResources';

const VELERO_NS = 'kube-system';

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

  if (diffMins < 0) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDuration(start: string, end: string): string {
  if (!start || !end) return '-';

  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(diffMs / 1000);

  if (secs < 60) return `${secs}s`;

  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function backupDetails(backup: InstanceType<typeof Backup>): string {
  const status = backup.jsonData.status;
  const parts: string[] = [];

  if (status?.failureReason) parts.push(status.failureReason);

  if (status?.validationErrors?.length) {
    parts.push(status.validationErrors.join('; '));
  }

  if (!parts.length && backup.errors > 0) {
    parts.push(`${backup.errors} error${backup.errors > 1 ? 's' : ''}`);
  }

  if (!parts.length && backup.warnings > 0) {
    parts.push(`${backup.warnings} warning${backup.warnings > 1 ? 's' : ''}`);
  }

  return parts.join(' — ') || '-';
}

function restoreDetails(restore: InstanceType<typeof Restore>): string {
  const status = restore.jsonData.status;
  const parts: string[] = [];

  if (status?.failureReason) parts.push(status.failureReason);

  if (status?.validationErrors?.length) {
    parts.push(status.validationErrors.join('; '));
  }

  if (!parts.length && restore.errors > 0) {
    parts.push(`${restore.errors} error${restore.errors > 1 ? 's' : ''}`);
  }

  if (!parts.length && restore.warnings > 0) {
    parts.push(`${restore.warnings} warning${restore.warnings > 1 ? 's' : ''}`);
  }

  return parts.join(' — ') || '-';
}

export default function BackupsPage() {
  const { drType, loading: configLoading } = useDrType();
  const [backups, backupsError] = Backup.useList({ namespace: VELERO_NS });
  const [schedules, schedulesError] = Schedule.useList({ namespace: VELERO_NS });
  const [restores, restoresError] = Restore.useList({ namespace: VELERO_NS });

  const drEnabled = drType !== '' && drType !== 'none';

  const sortedBackups = useMemo(() => {
    if (!backups) return [];

    return [...backups].sort(
      (a, b) =>
        new Date(b.startTimestamp || 0).getTime() - new Date(a.startTimestamp || 0).getTime()
    );
  }, [backups]);

  const sortedRestores = useMemo(() => {
    if (!restores) return [];

    return [...restores].sort(
      (a, b) =>
        new Date(b.startTimestamp || 0).getTime() - new Date(a.startTimestamp || 0).getTime()
    );
  }, [restores]);

  const stats = useMemo(() => {
    if (!backups) return { total: 0, completed: 0, failed: 0 };

    let completed = 0;
    let failed = 0;

    for (const b of backups) {
      const phase = b.phase;
      if (phase === 'Completed') completed++;
      if (phase === 'Failed' || phase === 'PartiallyFailed') failed++;
    }

    return { total: backups.length, completed, failed };
  }, [backups]);

  if (configLoading) {
    return (
      <SectionBox title="SD Backups">
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      </SectionBox>
    );
  }

  if (!drEnabled) {
    return (
      <SectionBox title="SD Backups">
        <Alert severity="info">
          Disaster Recovery is not enabled in this cluster. Set <code>dr.type</code> to{' '}
          <code>on-premises</code> or <code>eks</code> to enable Velero backups.
        </Alert>
      </SectionBox>
    );
  }

  const listError = backupsError || schedulesError || restoresError;

  return (
    <SectionBox title={<SectionFilterHeader title="SD Backups" noNamespaceFilter />}>
      <Alert severity="info" variant="outlined" sx={{ mb: 2 }} icon={false}>
        Unrestricted cluster-wide view
      </Alert>

      {listError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(listError as any)?.message || 'Failed to fetch Velero resources'}
        </Alert>
      )}

      <Box display="flex" gap={2} sx={{ mb: 3 }}>
        <Box flex={1}>
          <StatCard title="Total Backups" value={stats.total} color="text.primary" />
        </Box>
        <Box flex={1}>
          <StatCard title="Completed" value={stats.completed} color="success.main" />
        </Box>
        <Box flex={1}>
          <StatCard title="Failed" value={stats.failed} color="error.main" />
        </Box>
      </Box>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Schedules
      </Typography>
      <Table
        data={schedules || []}
        loading={!schedules}
        enableColumnFilters={false}
        columns={[
          {
            header: 'Name',
            accessorFn: (s: InstanceType<typeof Schedule>) => s.metadata.name,
            gridTemplate: '1fr',
          },
          {
            header: 'Cron Schedule',
            accessorFn: (s: InstanceType<typeof Schedule>) => s.cronSchedule,
            gridTemplate: 'min-content',
          },
          {
            header: 'Last Backup',
            accessorFn: (s: InstanceType<typeof Schedule>) => formatTime(s.lastBackup),
            gridTemplate: 'min-content',
          },
          {
            header: 'Status',
            accessorFn: (s: InstanceType<typeof Schedule>) => (s.paused ? 'Paused' : 'Active'),
            Cell: ({ cell }: any) => (
              <Chip
                label={cell.getValue()}
                size="small"
                color={cell.getValue() === 'Active' ? 'success' : 'warning'}
              />
            ),
            gridTemplate: 'min-content',
          },
        ]}
        emptyMessage="No backup schedules configured."
      />

      <Typography variant="h6" sx={{ mb: 1, mt: 3 }}>
        Recent Backups
      </Typography>
      <Table
        data={sortedBackups}
        loading={!backups}
        enableColumnFilters={false}
        columns={[
          {
            header: 'Name',
            accessorFn: (b: InstanceType<typeof Backup>) => b.metadata.name,
            gridTemplate: '1fr',
          },
          {
            header: 'Schedule',
            accessorFn: (b: InstanceType<typeof Backup>) => b.scheduleName || '-',
            gridTemplate: '0.7fr',
          },
          {
            header: 'Status',
            accessorFn: (b: InstanceType<typeof Backup>) => b.phase,
            Cell: ({ cell }: any) => {
              const phase = cell.getValue();
              let color: 'success' | 'error' | 'warning' | 'info' | 'default' = 'default';

              if (phase === 'Completed') color = 'success';
              else if (phase === 'Failed' || phase === 'PartiallyFailed') color = 'error';
              else if (phase === 'InProgress' || phase === 'New') color = 'info';
              else if (phase === 'Deleting') color = 'warning';

              return <Chip label={phase} size="small" color={color} />;
            },
            gridTemplate: 'min-content',
          },
          {
            header: 'Started',
            accessorFn: (b: InstanceType<typeof Backup>) => formatTime(b.startTimestamp),
            gridTemplate: 'min-content',
          },
          {
            header: 'Duration',
            accessorFn: (b: InstanceType<typeof Backup>) =>
              formatDuration(b.startTimestamp, b.completionTimestamp),
            gridTemplate: 'min-content',
          },
          {
            header: 'Details',
            accessorFn: (b: InstanceType<typeof Backup>) => backupDetails(b),
            gridTemplate: '1.5fr',
          },
        ]}
        emptyMessage="No backups found."
      />

      <Typography variant="h6" sx={{ mb: 1, mt: 3 }}>
        Restores
      </Typography>
      <Table
        data={sortedRestores}
        loading={!restores}
        enableColumnFilters={false}
        columns={[
          {
            header: 'Name',
            accessorFn: (r: InstanceType<typeof Restore>) => r.metadata.name,
            gridTemplate: '1fr',
          },
          {
            header: 'Backup',
            accessorFn: (r: InstanceType<typeof Restore>) => r.backupName || '-',
            gridTemplate: '0.7fr',
          },
          {
            header: 'Status',
            accessorFn: (r: InstanceType<typeof Restore>) => r.phase,
            Cell: ({ cell }: any) => {
              const phase = cell.getValue();
              let color: 'success' | 'error' | 'warning' | 'info' | 'default' = 'default';

              if (phase === 'Completed') color = 'success';
              else if (phase === 'Failed' || phase === 'PartiallyFailed') color = 'error';
              else if (phase === 'InProgress' || phase === 'New') color = 'info';
              else if (phase === 'Deleting') color = 'warning';

              return <Chip label={phase} size="small" color={color} />;
            },
            gridTemplate: 'min-content',
          },
          {
            header: 'Started',
            accessorFn: (r: InstanceType<typeof Restore>) => formatTime(r.startTimestamp),
            gridTemplate: 'min-content',
          },
          {
            header: 'Duration',
            accessorFn: (r: InstanceType<typeof Restore>) =>
              formatDuration(r.startTimestamp, r.completionTimestamp),
            gridTemplate: 'min-content',
          },
          {
            header: 'Details',
            accessorFn: (r: InstanceType<typeof Restore>) => restoreDetails(r),
            gridTemplate: '1.5fr',
          },
        ]}
        emptyMessage="No restores found."
      />
      <Box pb={3} />
    </SectionBox>
  );
}
