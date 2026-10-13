import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SectionFilterHeader, Table } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Autocomplete,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLoggingType } from './hooks';
import { LokiEvent, queryLokiEvents } from './lokiClient';
import { queryOpenSearchEvents } from './opensearchClient';

const TIME_RANGES = [
  { label: 'Last 1 min', seconds: 60 },
  { label: 'Last 5 min', seconds: 300 },
  { label: 'Last 15 min', seconds: 900 },
  { label: 'Last 30 min', seconds: 1800 },
  { label: 'Last 1 hour', seconds: 3600 },
  { label: 'Last 6 hours', seconds: 21600 },
  { label: 'Last 24 hours', seconds: 86400 },
  { label: 'Last 7 days', seconds: 604800 },
];

export default function EventsPage() {
  const { loggingType, loading: configLoading } = useLoggingType();
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const [events, setEvents] = useState<LokiEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(3600);
  const [selectedNs, setSelectedNs] = useState<string[]>([]);

  const isLoki = loggingType === 'loki';
  const isOpensearch = loggingType === 'opensearch';
  const hasLogging = isLoki || isOpensearch;

  const allowedNamespaces = useMemo(() => {
    if (!namespaces) return [] as string[];

    return namespaces.map((ns: any) => ns.metadata.name as string).sort();
  }, [namespaces]);

  const fetchEvents = useCallback(async () => {
    if (!hasLogging) return;

    setLoading(true);
    setError(null);

    try {
      const now = Math.floor(Date.now() / 1000);
      const from = now - timeRange;
      const result = isOpensearch
        ? await queryOpenSearchEvents(from, now)
        : await queryLokiEvents(from, now);

      setEvents(result);
    } catch (err: any) {
      setError(err.message || 'Failed to query events');
    } finally {
      setLoading(false);
    }
  }, [timeRange, hasLogging, isOpensearch]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const filteredEvents = useMemo(() => {
    let result = events;

    // Filter by allowed namespaces (Capsule tenant isolation)
    // namespaces !== null means the list has loaded; empty = user has no namespaces
    if (namespaces && allowedNamespaces.length === 0) {
      return [];
    }

    if (allowedNamespaces.length > 0) {
      const allowed = new Set(allowedNamespaces);

      result = result.filter(e => allowed.has(e.namespace));
    }

    // Filter by selected namespaces
    if (selectedNs.length > 0) {
      const selected = new Set(selectedNs);

      result = result.filter(e => selected.has(e.namespace));
    }

    return result;
  }, [events, allowedNamespaces, selectedNs]);

  if (configLoading) {
    return (
      <SectionBox title="SD Events">
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      </SectionBox>
    );
  }

  if (!hasLogging) {
    return (
      <SectionBox title="SD Events">
        <Alert severity="info">
          No event source available. Enable Loki or OpenSearch in this cluster.
        </Alert>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="SD Events"
          noNamespaceFilter
          actions={[
            <FormControl size="small" sx={{ minWidth: 140 }} key="time-range">
              <InputLabel>Time Range</InputLabel>
              <Select
                value={timeRange}
                label="Time Range"
                onChange={e => setTimeRange(Number(e.target.value))}
              >
                {TIME_RANGES.map(tr => (
                  <MenuItem key={tr.seconds} value={tr.seconds}>
                    {tr.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>,
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
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Table
        data={filteredEvents}
        loading={loading}
        enableColumnFilters={false}
        columns={[
          {
            header: 'Time',
            accessorFn: (event: LokiEvent) =>
              event.timestamp ? new Date(event.timestamp).toLocaleString() : '-',
            gridTemplate: 'min-content',
          },
          {
            header: 'Type',
            accessorFn: (event: LokiEvent) => event.type,
            gridTemplate: '0.5fr',
          },
          {
            header: 'Namespace',
            accessorFn: (event: LokiEvent) => event.namespace,
            gridTemplate: '0.7fr',
          },
          {
            header: 'Kind',
            accessorFn: (event: LokiEvent) => event.kind,
            gridTemplate: 'min-content',
          },
          {
            header: 'Name',
            accessorFn: (event: LokiEvent) => event.name,
            gridTemplate: '1fr',
          },
          {
            header: 'Reason',
            accessorFn: (event: LokiEvent) => event.reason,
            gridTemplate: 'min-content',
          },
          {
            header: 'Message',
            accessorFn: (event: LokiEvent) => event.message,
            gridTemplate: '3fr',
          },
        ]}
        emptyMessage="No events found"
        errorMessage={error || undefined}
      />
    </SectionBox>
  );
}
