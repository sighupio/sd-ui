import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export interface PolicyResult {
  source?: string;
  policy: string;
  rule: string;
  message: string;
  result: 'pass' | 'fail' | 'warn' | 'error' | 'skip';
  category?: string;
  severity?: string;
  scored?: boolean;
  timestamp?: { seconds: number; nanos: number };
}

export interface PolicyReportScope {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  uid?: string;
}

export interface PolicyReportData extends KubeObjectInterface {
  scope?: PolicyReportScope;
  results?: PolicyResult[];
  summary?: {
    pass?: number;
    fail?: number;
    warn?: number;
    error?: number;
    skip?: number;
  };
}

export class PolicyReport extends KubeObject<PolicyReportData> {
  static kind = 'PolicyReport';
  static apiName = 'policyreports';
  static apiVersion = 'wgpolicyk8s.io/v1alpha2';
  static isNamespaced = true;

  get results(): PolicyResult[] {
    return this.jsonData.results || [];
  }

  get scope(): PolicyReportScope | undefined {
    return this.jsonData.scope;
  }
}

export class ClusterPolicyReport extends KubeObject<PolicyReportData> {
  static kind = 'ClusterPolicyReport';
  static apiName = 'clusterpolicyreports';
  static apiVersion = 'wgpolicyk8s.io/v1alpha2';
  static isNamespaced = false;

  get results(): PolicyResult[] {
    return this.jsonData.results || [];
  }

  get scope(): PolicyReportScope | undefined {
    return this.jsonData.scope;
  }
}
