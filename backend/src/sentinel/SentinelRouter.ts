/**
 * Sentinel Router
 * Express API routes for ML-powered Early-Warning Forecasting and Pre-emptive Relief Actions.
 * Fully additive — zero modifications to existing routes or core logic.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { IncidentOrchestrator } from '../orchestrator/IncidentOrchestrator';
import { globalSentinelBuffer, MetricType } from './TelemetryBuffer';
import { globalForecastEngine } from './ForecastEngine';

const METRIC_THRESHOLDS: Record<MetricType, number> = {
  cpu: 0.85,
  memory: 0.85,
  connections: 85,
  workers: 85,
};

export function createSentinelRouter(orchestrator: IncidentOrchestrator): Router {
  const router = Router();

  const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  /**
   * GET /api/v1/incident/sentinel-forecast
   * Performs real-time time-series ML forecasting across all services and metrics.
   */
  router.get('/incident/sentinel-forecast', asyncHandler(async (_req: Request, res: Response) => {
    const bundle = orchestrator.getBundle();
    const currentTick = bundle?.playback?.tick ?? 0;
    
    // Update buffer with current tick
    globalSentinelBuffer.recordSnapshot(bundle);

    const servicesList: string[] = ['gateway', 'portal', 'appointment', 'records', 'billing', 'notification'];
    const metricsList: MetricType[] = ['cpu', 'memory', 'connections', 'workers'];

    // If current telemetry has services, extract actual service IDs
    const telemetryServices = bundle?.currentTelemetry?.services;
    const activeServiceIds = (Array.isArray(telemetryServices) && telemetryServices.length > 0)
      ? telemetryServices.map((s: any) => String(s.serviceId).toLowerCase())
      : servicesList;

    const forecastTasks: Promise<any>[] = [];

    for (const serviceId of activeServiceIds) {
      for (const metric of metricsList) {
        forecastTasks.push((async () => {
          const history = globalSentinelBuffer.getHistory(bundle, serviceId, metric, 30);
          const currentValue = history[history.length - 1] ?? 0;
          const threshold = METRIC_THRESHOLDS[metric];

          const forecastResult = await globalForecastEngine.forecastMetric(history, 20);
          const { median, q10, q90, modelUsed } = forecastResult;

          const isCurrentBreach = currentValue >= threshold;

          // Find first tick index in forecast where median crosses critical threshold
          let breachIndex = -1;
          for (let i = 0; i < median.length; i++) {
            if (median[i] >= threshold) {
              breachIndex = i;
              break;
            }
          }

          const breachExpectedAtTick = isCurrentBreach ? currentTick : (breachIndex !== -1 ? currentTick + (breachIndex + 1) : null);
          const ticksUntilBreach = isCurrentBreach ? 0 : (breachIndex !== -1 ? breachIndex + 1 : null);
          const breachStatus: 'ACTIVE_BREACH' | 'FORECASTED_BREACH' | 'NOMINAL' = 
            isCurrentBreach ? 'ACTIVE_BREACH' : (breachExpectedAtTick !== null ? 'FORECASTED_BREACH' : 'NOMINAL');

          // Calculate forecast confidence level
          let confidence: 'low' | 'medium' | 'high' = 'medium';
          if (history.length >= 20) {
            const spreadAtEnd = q90[q90.length - 1] - q10[q10.length - 1];
            confidence = spreadAtEnd < 0.25 ? 'high' : 'medium';
          } else if (history.length < 8) {
            confidence = 'low';
          }

          return {
            serviceId,
            metric,
            currentValue: Number(currentValue.toFixed(4)),
            threshold,
            history: history.map(v => Number(v.toFixed(4))),
            forecast: {
              median: median.map(v => Number(v.toFixed(4))),
              q10: q10.map(v => Number(v.toFixed(4))),
              q90: q90.map(v => Number(v.toFixed(4))),
            },
            isCurrentBreach,
            breachStatus,
            breachExpectedAtTick,
            ticksUntilBreach,
            confidence,
            modelUsed,
          };
        })());
      }
    }

    const forecasts = await Promise.all(forecastTasks);

    res.json({
      currentTick,
      scenarioId: (orchestrator as any).scenarioId || 'default',
      timestamp: Date.now(),
      totalServices: activeServiceIds.length,
      flaggedCount: forecasts.filter(f => f.breachExpectedAtTick !== null).length,
      activeBreachCount: forecasts.filter(f => f.isCurrentBreach).length,
      forecastedBreachCount: forecasts.filter(f => !f.isCurrentBreach && f.breachExpectedAtTick !== null).length,
      forecasts,
    });
  }));

  /**
   * POST /api/v1/incident/sentinel-scenario
   * Start a specific Sentinel test scenario (nominal, slow_creep, sudden_spike, already_breaching, or random).
   */
  router.post('/incident/sentinel-scenario', asyncHandler(async (req: Request, res: Response) => {
    let { scenarioId } = req.body;
    const testScenarios = [
      'sentinel_test_nominal',
      'sentinel_test_slow_creep',
      'sentinel_test_sudden_spike',
      'sentinel_test_already_breaching'
    ];

    if (scenarioId === 'random' || !scenarioId) {
      scenarioId = testScenarios[Math.floor(Math.random() * testScenarios.length)];
    }

    if (!testScenarios.includes(scenarioId)) {
      throw { errorCode: 'BAD_REQUEST', message: `Invalid scenarioId. Must be one of: ${testScenarios.join(', ')}, or "random"` };
    }

    orchestrator.startScenario(scenarioId);

    console.log(`[Sentinel] Started test scenario: ${scenarioId}`);

    res.json({
      success: true,
      scenarioId,
      message: `Started Sentinel test scenario: ${scenarioId}`,
      bundle: orchestrator.getBundle()
    });
  }));

  /**
   * POST /api/v1/incident/sentinel-preempt
   * Triggers pre-emptive relief action on a service metric before causal engine confirmation.
   */
  router.post('/incident/sentinel-preempt', asyncHandler(async (req: Request, res: Response) => {
    const { serviceId, metric } = req.body;
    if (!serviceId || !metric) {
      throw { errorCode: 'BAD_REQUEST', message: 'serviceId and metric are required' };
    }

    const targetService = String(serviceId).toLowerCase();
    const targetMetric = String(metric).toLowerCase() as MetricType;

    // Apply pre-emptive relief directly on the simulation world
    const world = (orchestrator as any).world;
    if (world && typeof world.relieveExhaustion === 'function') {
      world.relieveExhaustion(targetService, targetMetric);
    }

    console.log(`[Sentinel] Pre-emptive relief applied to ${targetService.toUpperCase()} ${targetMetric.toUpperCase()}`);

    res.json({
      success: true,
      serviceId: targetService,
      metric: targetMetric,
      status: 'PREEMPTED',
      message: `Pre-emptive relief successfully applied to ${targetService.toUpperCase()} ${targetMetric.toUpperCase()}`,
      preemptedAtTick: orchestrator.getBundle()?.playback?.tick ?? 0,
    });
  }));

  return router;
}
