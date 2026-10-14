import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';

const store = new ConfigStore<Record<string, any>>('prometheus');

store.update({
  main: {
    autoDetect: false,
    isMetricsEnabled: true,
    address: 'monitoring/prometheus-k8s:9090',
  },
});
