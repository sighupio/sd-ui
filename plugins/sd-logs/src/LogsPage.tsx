import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { LogViewer, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Autocomplete,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLoggingType } from './hooks';
import { LogEntry, queryLokiLogs } from './lokiLogClient';
import { queryOpenSearchLogs } from './opensearchLogClient';

const TIME_RANGES = [
  { label: 'Last 5 min', seconds: 300 },
  { label: 'Last 15 min', seconds: 900 },
  { label: 'Last 30 min', seconds: 1800 },
  { label: 'Last 1 hour', seconds: 3600 },
  { label: 'Last 6 hours', seconds: 21600 },
  { label: 'Last 24 hours', seconds: 86400 },
  { label: 'Last 7 days', seconds: 604800 },
];

const LINE_LIMITS = [
  { label: '100', value: 100 },
  { label: '1000', value: 1000 },
  { label: '2500', value: 2500 },
  { label: 'All', value: 10000 },
];

// ANSI colors for pod names in xterm
const POD_COLORS = [
  '\x1b[36m', '\x1b[33m', '\x1b[35m', '\x1b[32m',
  '\x1b[34m', '\x1b[91m', '\x1b[96m', '\x1b[93m',
];
const CONTAINER_COLOR = '\x1b[90m'; // gray
const RESET = '\x1b[0m';

interface WorkloadOption {
  kind: string;
  name: string;
  label: string;
}

export default function LogsPage() {
  const { loggingType, loading: configLoading } = useLoggingType();
  const isLoki = loggingType === 'loki';
  const isOpensearch = loggingType === 'opensearch';
  const hasLogging = isLoki || isOpensearch;

  // K8s resources for drilldown
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const [allPods] = K8s.ResourceClasses.Pod.useList();
  const [deployments] = K8s.ResourceClasses.Deployment.useList();
  const [daemonSets] = K8s.ResourceClasses.DaemonSet.useList();
  const [statefulSets] = K8s.ResourceClasses.StatefulSet.useList();

  // Drilldown state
  const [selectedNs, setSelectedNs] = useState<string | null>(null);
  const [selectedWorkload, setSelectedWorkload] = useState<WorkloadOption | null>(null);
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);

  // Log controls
  const [timeRange, setTimeRange] = useState(300);
  const [lineLimit, setLineLimit] = useState(1000);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [follow, setFollow] = useState(() => {
    const saved = localStorage.getItem('sd-logs.follow');

    return saved !== 'false';
  });

  // Log data — track all entries + what's been written to xterm
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const followRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const xtermRef = useRef<any>(null);
  const writtenCountRef = useRef(0);
  const lastTsRef = useRef(0);
  const podColorMapRef = useRef(new Map<string, string>());

  // Allowed namespaces (Capsule)
  const allowedNamespaces = useMemo(() => {
    if (!namespaces) return [] as string[];

    return namespaces.map((ns: any) => ns.metadata.name as string).sort();
  }, [namespaces]);

  // Workloads in selected namespace
  const workloadOptions = useMemo(() => {
    if (!selectedNs) return [] as WorkloadOption[];

    const options: WorkloadOption[] = [];

    if (deployments) {
      for (const d of deployments) {
        if ((d as any).metadata?.namespace === selectedNs) {
          const name = (d as any).metadata.name;

          options.push({ kind: 'Deployment', name, label: `Deployment/${name}` });
        }
      }
    }

    if (daemonSets) {
      for (const ds of daemonSets) {
        if ((ds as any).metadata?.namespace === selectedNs) {
          const name = (ds as any).metadata.name;

          options.push({ kind: 'DaemonSet', name, label: `DaemonSet/${name}` });
        }
      }
    }

    if (statefulSets) {
      for (const ss of statefulSets) {
        if ((ss as any).metadata?.namespace === selectedNs) {
          const name = (ss as any).metadata.name;

          options.push({ kind: 'StatefulSet', name, label: `StatefulSet/${name}` });
        }
      }
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedNs, deployments, daemonSets, statefulSets]);

  // Pods matching selected workload
  const podOptions = useMemo(() => {
    if (!selectedNs || !allPods) return [] as string[];

    let pods = allPods.filter((p: any) => p.metadata?.namespace === selectedNs);

    if (selectedWorkload) {
      pods = pods.filter((p: any) => {
        const owners = p.metadata?.ownerReferences || [];

        return owners.some(
          (o: any) =>
            o.kind === 'ReplicaSet' || o.kind === selectedWorkload.kind
        ) && p.metadata?.name?.includes(selectedWorkload.name);
      });
    }

    return pods.map((p: any) => p.metadata.name as string).sort();
  }, [selectedNs, selectedWorkload, allPods]);

  // Containers in selected pod
  const containerOptions = useMemo(() => {
    if (!selectedPod || !allPods) return [] as string[];

    const pod = allPods.find(
      (p: any) => p.metadata?.namespace === selectedNs && p.metadata?.name === selectedPod
    );

    if (!pod) return [];

    const containers = (pod as any).jsonData?.spec?.containers || [];

    return containers.map((c: any) => c.name as string);
  }, [selectedPod, selectedNs, allPods]);

  // Auto-select single container
  useEffect(() => {
    if (containerOptions.length === 1) {
      setSelectedContainer(containerOptions[0]);
    }
  }, [containerOptions]);

  // Reset downstream selections on parent change
  useEffect(() => {
    setSelectedWorkload(null);
    setSelectedPod(null);
    setSelectedContainer(null);
  }, [selectedNs]);

  useEffect(() => {
    setSelectedPod(null);
    setSelectedContainer(null);
  }, [selectedWorkload]);

  useEffect(() => {
    setSelectedContainer(null);
  }, [selectedPod]);

  function getPodColor(pod: string): string {
    if (!podColorMapRef.current.has(pod)) {
      const idx = podColorMapRef.current.size % POD_COLORS.length;

      podColorMapRef.current.set(pod, POD_COLORS[idx]);
    }

    return podColorMapRef.current.get(pod) || POD_COLORS[0];
  }

  function formatEntry(entry: LogEntry): string {
    const parts: string[] = [];

    if (showTimestamps && entry.ts > 0) {
      parts.push(new Date(entry.ts).toISOString().replace('T', ' ').replace('Z', ''));
    }

    if (entry.pod) {
      parts.push(`${getPodColor(entry.pod)}[${entry.pod}]${RESET}`);
    }

    if (entry.container) {
      parts.push(`${CONTAINER_COLOR}[${entry.container}]${RESET}`);
    }

    parts.push(entry.line);

    return parts.join('  ');
  }

  // Write entries to xterm directly
  function writeToXterm(entries: LogEntry[]) {
    if (!xtermRef.current) return;

    for (const entry of entries) {
      xtermRef.current.write(`${formatEntry(entry)}\r\n`);
    }

    xtermRef.current.scrollToBottom?.();
  }

  // Clear xterm and reset tracking
  function clearXterm() {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }

    writtenCountRef.current = 0;
    lastTsRef.current = 0;
  }

  // Fetch logs
  const fetchLogs = useCallback(async (incremental?: boolean) => {
    if (!selectedNs || !hasLogging) return;

    if (!incremental) {
      setLoading(true);
    }

    setError(null);

    try {
      const now = Math.floor(Date.now() / 1000);
      const from = incremental && lastTsRef.current > 0
        ? Math.floor(lastTsRef.current / 1000) // from last timestamp (seconds)
        : now - timeRange;

      let result: LogEntry[];

      // Determine pod filter: specific pod, or all pods from workload (regex)
      let podFilter = selectedPod || undefined;

      if (!podFilter && selectedWorkload && allPods) {
        const workloadPods = allPods
          .filter((p: any) =>
            p.metadata?.namespace === selectedNs &&
            p.metadata?.name?.includes(selectedWorkload.name)
          )
          .map((p: any) => p.metadata.name as string);

        if (workloadPods.length > 0) {
          podFilter = workloadPods.join('|');
        }
      }

      if (isOpensearch) {
        result = await queryOpenSearchLogs(
          selectedNs, podFilter, selectedContainer || undefined,
          from, now, lineLimit
        );
      } else {
        result = await queryLokiLogs(
          selectedNs, podFilter, selectedContainer || undefined,
          from, now, lineLimit
        );
      }

      if (incremental) {
        // Only write entries newer than what we already have
        const newEntries = result.filter(e => e.ts > lastTsRef.current);

        if (newEntries.length > 0) {
          setAllLogs(prev => [...prev, ...newEntries]);
          writeToXterm(newEntries);
          lastTsRef.current = newEntries[newEntries.length - 1].ts;
        }
      } else {
        // Full fetch — clear and write everything
        clearXterm();
        setAllLogs(result);

        // Wait for xterm to be ready, then write
        setTimeout(() => {
          writeToXterm(result);

          if (result.length > 0) {
            lastTsRef.current = result[result.length - 1].ts;
          }
        }, 100);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [selectedNs, selectedPod, selectedWorkload, allPods, selectedContainer, timeRange, lineLimit, hasLogging, isOpensearch, showTimestamps]);

  // Fetch on selection change (full fetch)
  useEffect(() => {
    if (selectedNs) {
      fetchLogs(false);
    }
  }, [selectedNs, selectedWorkload, selectedPod, selectedContainer, timeRange, lineLimit]);

  // Follow mode — poll every 3s (incremental)
  useEffect(() => {
    if (follow && selectedNs) {
      followRef.current = setInterval(() => fetchLogs(true), 3000);
    }

    return () => {
      if (followRef.current) {
        clearInterval(followRef.current);
        followRef.current = null;
      }
    };
  }, [follow, fetchLogs, selectedNs]);

  // Persist follow preference
  useEffect(() => {
    localStorage.setItem('sd-logs.follow', String(follow));
  }, [follow]);

  // Plain-text logs for download (no ANSI escape codes)
  const downloadLogs = useMemo(() => {
    return allLogs.map(entry => {
      const parts: string[] = [];

      if (entry.ts > 0) {
        parts.push(new Date(entry.ts).toISOString().replace('T', ' ').replace('Z', ''));
      }

      if (entry.pod) parts.push(`[${entry.pod}]`);
      if (entry.container) parts.push(`[${entry.container}]`);
      parts.push(entry.line);

      return parts.join('  ');
    });
  }, [allLogs]);

  if (configLoading) {
    return (
      <SectionBox title="SD Logs">
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      </SectionBox>
    );
  }

  if (!hasLogging) {
    return (
      <SectionBox title="SD Logs">
        <Alert severity="info">
          Enable Loki or OpenSearch to view container logs.
        </Alert>
      </SectionBox>
    );
  }

  const topActions = [
    <FormControl size="small" sx={{ minWidth: 90 }} key="lines">
      <InputLabel>Lines</InputLabel>
      <Select value={lineLimit} label="Lines" onChange={e => setLineLimit(Number(e.target.value))}>
        {LINE_LIMITS.map(l => (
          <MenuItem key={l.value} value={l.value}>{l.label}</MenuItem>
        ))}
      </Select>
    </FormControl>,
    <FormControl size="small" sx={{ minWidth: 130 }} key="time-range">
      <InputLabel>Time Range</InputLabel>
      <Select value={timeRange} label="Time Range" onChange={e => setTimeRange(Number(e.target.value))}>
        {TIME_RANGES.map(tr => (
          <MenuItem key={tr.seconds} value={tr.seconds}>{tr.label}</MenuItem>
        ))}
      </Select>
    </FormControl>,
    <Box key="timestamps" display="flex" alignItems="center" gap={0.5}>
      <Typography variant="caption">Timestamps</Typography>
      <Switch size="small" checked={showTimestamps} onChange={(_, v) => setShowTimestamps(v)} />
    </Box>,
    <Box key="follow" display="flex" alignItems="center" gap={0.5}>
      <Typography variant="caption">Follow</Typography>
      <Switch size="small" checked={follow} onChange={(_, v) => setFollow(v)} />
    </Box>,
  ];

  return (
    <SectionBox title="SD Logs">
      <Box display="flex" gap={1} flexWrap="wrap" sx={{ mb: 2 }}>
        <Autocomplete
          size="small"
          options={allowedNamespaces}
          value={selectedNs}
          onChange={(_, v) => setSelectedNs(v)}
          renderInput={params => <TextField {...params} label="Namespace" />}
          sx={{ minWidth: 160 }}
        />
        <Autocomplete
          size="small"
          options={workloadOptions}
          value={selectedWorkload}
          onChange={(_, v) => setSelectedWorkload(v)}
          getOptionLabel={o => o.label}
          isOptionEqualToValue={(a, b) => a.label === b.label}
          renderInput={params => <TextField {...params} label="Workload" />}
          sx={{ minWidth: 220 }}
          disabled={!selectedNs}
        />
        <Autocomplete
          size="small"
          options={podOptions}
          value={selectedPod}
          onChange={(_, v) => setSelectedPod(v)}
          renderInput={params => <TextField {...params} label="Pod" />}
          sx={{ minWidth: 260 }}
          disabled={!selectedNs}
        />
        <Autocomplete
          size="small"
          options={containerOptions}
          value={selectedContainer}
          onChange={(_, v) => setSelectedContainer(v)}
          renderInput={params => <TextField {...params} label="Container" />}
          sx={{ minWidth: 160 }}
          disabled={!selectedPod}
        />
      </Box>

      <Alert severity="info" variant="outlined" sx={{ mb: 2 }} icon={false}>
        Logs are retrieved from {isLoki ? 'Loki' : 'OpenSearch'} and may be delayed depending on the log ingestion pipeline.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!selectedNs ? (
        <Alert severity="info">Select a namespace to view logs.</Alert>
      ) : loading && allLogs.length === 0 ? (
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{
          height: 'calc(100vh - 200px)',
          minHeight: 500,
          width: '100%',
          '& .MuiDialogContent-root': {
            width: '100%',
            maxWidth: 'none',
            padding: 0,
          },
        }}>
          <LogViewer
            logs={downloadLogs}
            title={`Logs: ${selectedPod || selectedNs}`}
            downloadName={`sd-logs-${selectedNs}-${selectedPod || 'all'}`}
            open
            onClose={() => {}}
            topActions={topActions}
            xtermRef={xtermRef}
            noDialog
          />
        </Box>
      )}
    </SectionBox>
  );
}
