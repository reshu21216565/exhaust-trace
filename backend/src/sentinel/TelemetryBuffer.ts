/**
 * Sentinel TelemetryBuffer
 * Lightweight in-memory rolling buffer for service telemetry history.
 * Zero modifications to existing ObservationAdapter or SimulationWorld.
 */

export type MetricType = 'cpu' | 'memory' | 'connections' | 'workers';

export class TelemetryBuffer {
  private bufferMap = new Map<string, number[]>();

  /**
   * Record telemetry snapshot into rolling buffer (last 40 ticks per service/metric).
   */
  public recordSnapshot(bundle: any): void {
    if (!bundle) return;

    const currentTelemetry = bundle.currentTelemetry;
    if (!currentTelemetry || !Array.isArray(currentTelemetry.services)) return;

    for (const service of currentTelemetry.services) {
      const serviceId = String(service.serviceId || '').toLowerCase();
      const resources = service.resources || {};

      const cpuVal = resources.CPU?.utilization ?? service.metrics?.cpu ?? 0.2;
      const memVal = resources.MEMORY?.utilization ?? service.metrics?.memory ?? 0.25;
      const connVal = (resources.CONNECTIONS?.utilization != null ? resources.CONNECTIONS.utilization * 100 : service.metrics?.connections) ?? 20;
      const workVal = (resources.WORKERS?.utilization != null ? resources.WORKERS.utilization * 100 : service.metrics?.workers) ?? 20;

      this.appendValue(serviceId, 'cpu', cpuVal);
      this.appendValue(serviceId, 'memory', memVal);
      this.appendValue(serviceId, 'connections', connVal);
      this.appendValue(serviceId, 'workers', workVal);
    }
  }

  private appendValue(serviceId: string, metric: MetricType, val: number): void {
    const key = `${serviceId}:${metric}`;
    let list = this.bufferMap.get(key);
    if (!list) {
      list = [];
      this.bufferMap.set(key, list);
    }
    list.push(val);
    if (list.length > 40) {
      list.shift();
    }
  }

  /**
   * Retrieve last N values for service + metric.
   * If buffer is empty, extracts from bundle.telemetryHistory.
   */
  public getHistory(bundle: any, serviceId: string, metric: MetricType, limit = 30): number[] {
    const key = `${serviceId.toLowerCase()}:${metric}`;
    const buffered = this.bufferMap.get(key);

    if (buffered && buffered.length >= 5) {
      return buffered.slice(-limit);
    }

    // Extract from bundle.telemetryHistory if buffer is fresh or empty
    const history: number[] = [];
    const metricUpper = metric.toUpperCase();

    if (bundle && Array.isArray(bundle.telemetryHistory)) {
      for (const tSnap of bundle.telemetryHistory) {
        if (!tSnap || !Array.isArray(tSnap.services)) continue;
        const target = tSnap.services.find((s: any) => String(s.serviceId).toLowerCase() === serviceId.toLowerCase());
        if (target) {
          const res = target.resources?.[metricUpper];
          let val = res?.utilization ?? target.metrics?.[metric];
          if (val !== undefined) {
            if (metric === 'connections' || metric === 'workers') {
              if (val <= 1.0) val *= 100;
            }
            history.push(val);
          }
        }
      }
    }

    // Add current tick value if present
    if (bundle?.currentTelemetry?.services) {
      const target = bundle.currentTelemetry.services.find((s: any) => String(s.serviceId).toLowerCase() === serviceId.toLowerCase());
      if (target) {
        const res = target.resources?.[metricUpper];
        let val = res?.utilization ?? target.metrics?.[metric];
        if (val !== undefined) {
          if (metric === 'connections' || metric === 'workers') {
            if (val <= 1.0) val *= 100;
          }
          history.push(val);
        }
      }
    }

    if (history.length > 0) {
      return history.slice(-limit);
    }

    // Default synthetic baseline if no history yet
    const baselineVal = (metric === 'connections' || metric === 'workers') ? 20 : 0.25;
    return Array.from({ length: 15 }, () => baselineVal);
  }
}

export const globalSentinelBuffer = new TelemetryBuffer();
