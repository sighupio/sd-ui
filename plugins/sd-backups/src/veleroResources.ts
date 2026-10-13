import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export interface VeleroBackup extends KubeObjectInterface {
  spec: {
    includedNamespaces?: string[];
    excludedNamespaces?: string[];
    storageLocation?: string;
    ttl?: string;
    schedule?: string;
  };
  status?: {
    phase?: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    expiration?: string;
    errors?: number;
    warnings?: number;
    failureReason?: string;
    validationErrors?: string[];
    volumeSnapshotsAttempted?: number;
    volumeSnapshotsCompleted?: number;
  };
}

export class Backup extends KubeObject<VeleroBackup> {
  static kind = 'Backup';
  static apiName = 'backups';
  static apiVersion = 'velero.io/v1';
  static isNamespaced = true;

  get phase(): string {
    return this.jsonData.status?.phase || 'Unknown';
  }

  get startTimestamp(): string {
    return this.jsonData.status?.startTimestamp || '';
  }

  get completionTimestamp(): string {
    return this.jsonData.status?.completionTimestamp || '';
  }

  get errors(): number {
    return this.jsonData.status?.errors || 0;
  }

  get warnings(): number {
    return this.jsonData.status?.warnings || 0;
  }

  get scheduleName(): string {
    const labels = this.jsonData.metadata?.labels || {};
    return labels['velero.io/schedule-name'] || '';
  }
}

export interface VeleroSchedule extends KubeObjectInterface {
  spec: {
    schedule?: string;
    template?: {
      includedNamespaces?: string[];
      excludedNamespaces?: string[];
      ttl?: string;
      storageLocation?: string;
    };
    paused?: boolean;
  };
  status?: {
    phase?: string;
    lastBackup?: string;
  };
}

export class Schedule extends KubeObject<VeleroSchedule> {
  static kind = 'Schedule';
  static apiName = 'schedules';
  static apiVersion = 'velero.io/v1';
  static isNamespaced = true;

  get cronSchedule(): string {
    return this.jsonData.spec?.schedule || '';
  }

  get paused(): boolean {
    return this.jsonData.spec?.paused || false;
  }

  get lastBackup(): string {
    return this.jsonData.status?.lastBackup || '';
  }

  get phase(): string {
    return this.jsonData.status?.phase || '';
  }
}

export interface VeleroRestore extends KubeObjectInterface {
  spec: {
    backupName?: string;
    includedNamespaces?: string[];
    excludedNamespaces?: string[];
  };
  status?: {
    phase?: string;
    startTimestamp?: string;
    completionTimestamp?: string;
    errors?: number;
    warnings?: number;
    failureReason?: string;
    validationErrors?: string[];
  };
}

export class Restore extends KubeObject<VeleroRestore> {
  static kind = 'Restore';
  static apiName = 'restores';
  static apiVersion = 'velero.io/v1';
  static isNamespaced = true;

  get phase(): string {
    return this.jsonData.status?.phase || 'Unknown';
  }

  get backupName(): string {
    return this.jsonData.spec?.backupName || '';
  }

  get startTimestamp(): string {
    return this.jsonData.status?.startTimestamp || '';
  }

  get completionTimestamp(): string {
    return this.jsonData.status?.completionTimestamp || '';
  }

  get errors(): number {
    return this.jsonData.status?.errors || 0;
  }

  get warnings(): number {
    return this.jsonData.status?.warnings || 0;
  }
}
