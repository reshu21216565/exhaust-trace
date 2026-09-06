/**
 * SentinelPage
 * Standalone ML-Powered Early-Warning Forecasting dashboard (/sentinel).
 * Supports 4 Randomized / Selectable Test Scenarios for empirical verification and live demoing.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Radar, ShieldCheck, AlertTriangle, Cpu, Activity, RefreshCw, Zap, Sparkles, CheckCircle2, ArrowLeft, Flame, Dices } from 'lucide-react';
import { useIncident } from '../lib/IncidentContext';
import { SentinelForecastCard, type MetricForecastData } from '../components/sentinel/SentinelForecastCard';
import { TopBar } from '../components/TopBar';
import { clsx } from 'clsx';

interface SentinelResponse {
  currentTick: number;
  scenarioId: string;
  timestamp: number;
  totalServices: number;
  flaggedCount: number;
  activeBreachCount: number;
  forecastedBreachCount: number;
  forecasts: MetricForecastData[];
}

const TEST_SCENARIOS = [
  { id: 'sentinel_test_nominal', label: 'Scenario A: Nominal System', badge: 'ALL HEALTHY', desc: 'No exhaustion. Sentinel shows all-clear.' },
  { id: 'sentinel_test_slow_creep', label: 'Scenario B: Slow Creep', badge: 'EARLY WARNING', desc: 'Gradual rise over ticks. Forecasts breach ~15 ticks ahead.' },
  { id: 'sentinel_test_sudden_spike', label: 'Scenario C: Sudden Spike', badge: 'SHORT LEAD', desc: 'Rapid jump in connections. Short warning window.' },
  { id: 'sentinel_test_already_breaching', label: 'Scenario D: Already Breaching', badge: 'ACTIVE CRITICAL', desc: 'Immediate breach at load. Distinct active state.' },
];

export const SentinelPage: React.FC<{ onBackToDashboard?: () => void }> = ({ onBackToDashboard }) => {
  const { bundle } = useIncident();
  const [data, setData] = useState<SentinelResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeScenario, setActiveScenario] = useState<string>('random');

  const fetchForecasts = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/sentinel-forecast');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.scenarioId) setActiveScenario(json.scenarioId);
      }
    } catch (err) {
      console.warn('[Sentinel] Failed to fetch forecasts:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const selectScenario = async (scenarioId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/sentinel-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId }),
      });
      if (res.ok) {
        const json = await res.json();
        setActiveScenario(json.scenarioId);
        await fetchForecasts();
      }
    } catch (err) {
      console.error('[Sentinel] Failed to switch scenario:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch initial forecasts & setup auto-refresh interval
  useEffect(() => {
    // If opening page for the first time, randomize test scenario for rich demo experience
    selectScenario('random');

    const interval = setInterval(() => {
      fetchForecasts();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handlePreempt = async (serviceId: string, metric: string) => {
    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/sentinel-preempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, metric }),
      });
      if (res.ok) {
        setTimeout(() => fetchForecasts(), 400);
      }
    } catch (err) {
      console.error('[Sentinel] Pre-empt action failed:', err);
    }
  };

  // Group forecasts by serviceId
  const serviceGroups = React.useMemo(() => {
    if (!data || !Array.isArray(data.forecasts)) return {};
    const groups: Record<string, MetricForecastData[]> = {};
    for (const f of data.forecasts) {
      if (!groups[f.serviceId]) groups[f.serviceId] = [];
      groups[f.serviceId].push(f);
    }
    return groups;
  }, [data]);

  const serviceIds = Object.keys(serviceGroups);
  const flaggedCount = data?.flaggedCount ?? 0;
  const activeBreachCount = data?.activeBreachCount ?? 0;
  const forecastedBreachCount = data?.forecastedBreachCount ?? 0;
  const currentTick = bundle?.playback?.tick ?? data?.currentTick ?? 0;

  // Earliest breach across all services
  const earliestBreach = React.useMemo(() => {
    if (!data?.forecasts) return null;
    let minTicks = 999;
    let target: MetricForecastData | null = null;
    for (const f of data.forecasts) {
      if (f.breachExpectedAtTick !== null && (f.ticksUntilBreach ?? 999) < minTicks) {
        minTicks = f.ticksUntilBreach!;
        target = f;
      }
    }
    return target;
  }, [data]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-background text-textMain relative">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header Hero Section */}
        <div className="glass-panel p-6 relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-primary/20">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="space-y-1 relative z-10">
            <div className="flex items-center gap-3 flex-wrap">
              {onBackToDashboard && (
                <button
                  onClick={onBackToDashboard}
                  className="p-1.5 rounded-lg border border-border hover:bg-surfaceHover text-textMuted hover:text-textMain transition-colors mr-1"
                  title="Return to Dashboard"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 flex items-center gap-1.5 uppercase tracking-widest shadow-sm">
                <Radar className="w-3.5 h-3.5 animate-spin-slow" />
                SENTINEL EARLY-WARNING FORECASTING
              </span>
              <span className="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold bg-surface border border-border text-textMuted uppercase">
                MODEL: amazon/chronos-t5-small
              </span>
            </div>
            <h1 className="text-2xl font-bold text-textMain tracking-tight">
              Pre-Emptive Resource Exhaustion Radar
            </h1>
            <p className="text-xs text-textMuted font-mono">
              Fulfilling the <strong className="text-primary">PREVENT</strong> guarantee — zero-shot ML time-series forecasting predicts breaches up to 20 ticks before hypotheses form.
            </p>
          </div>

          <div className="flex items-center gap-3 relative z-10">
            <button
              onClick={() => fetchForecasts(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-2 border border-border bg-surface hover:bg-surfaceHover text-textMuted hover:text-textMain rounded-lg text-xs font-mono transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
              Refresh Radar
            </button>
          </div>
        </div>

        {/* Demo Scenario Control Toolbar */}
        <div className="glass-panel p-4 border-primary/30 bg-primary/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-textMain">
              Demo Scenario Selector:
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {TEST_SCENARIOS.map(scen => (
              <button
                key={scen.id}
                onClick={() => selectScenario(scen.id)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border flex items-center gap-1.5',
                  activeScenario === scen.id
                    ? 'bg-primary text-white border-primary shadow-md shadow-primary/30'
                    : 'bg-surface border-border text-textMuted hover:text-textMain hover:border-primary/40'
                )}
                title={scen.desc}
              >
                <span>{scen.label.split(':')[1] || scen.label}</span>
              </button>
            ))}
            <button
              onClick={() => selectScenario('random')}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-surface border border-border text-textMuted hover:text-primary hover:border-primary/40 flex items-center gap-1 transition-all"
              title="Randomize scenario on refresh"
            >
              <Dices className="w-3.5 h-3.5 text-primary" />
              Random
            </button>
          </div>
        </div>

        {/* Key Metrics Stats Summary Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass-panel p-4 flex items-center gap-3 border-border/50">
            <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono text-textMuted uppercase tracking-wider block">Monitored Services</span>
              <span className="text-xl font-mono font-bold text-textMain">{serviceIds.length || 6} Microservices</span>
            </div>
          </div>

          <div className="glass-panel p-4 flex items-center gap-3 border-border/50">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${activeBreachCount > 0 ? 'bg-red-500/20 border-red-500/40 text-red-400' : forecastedBreachCount > 0 ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-healthy/10 border-healthy/20 text-healthy'}`}>
              {activeBreachCount > 0 ? <Flame className="w-5 h-5 animate-pulse" /> : forecastedBreachCount > 0 ? <AlertTriangle className="w-5 h-5 animate-pulse" /> : <ShieldCheck className="w-5 h-5" />}
            </div>
            <div>
              <span className="text-[10px] font-mono text-textMuted uppercase tracking-wider block">Breach Alerts</span>
              <span className={`text-xl font-mono font-bold ${activeBreachCount > 0 ? 'text-red-400' : forecastedBreachCount > 0 ? 'text-amber-400' : 'text-healthy'}`}>
                {activeBreachCount > 0 ? `${activeBreachCount} Active` : forecastedBreachCount > 0 ? `${forecastedBreachCount} Forecasted` : '0 Alerts'}
              </span>
            </div>
          </div>

          <div className="glass-panel p-4 flex items-center gap-3 border-border/50">
            <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center text-textMuted">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <span className="text-[10px] font-mono text-textMuted uppercase tracking-wider block">Earliest Target</span>
              <span className="text-sm font-mono font-bold text-textMain">
                {earliestBreach ? `${earliestBreach.serviceId.toUpperCase()} ${earliestBreach.metric.toUpperCase()}` : 'None (Nominal)'}
              </span>
            </div>
          </div>

          <div className="glass-panel p-4 flex items-center gap-3 border-border/50">
            <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center text-textMuted">
              <Cpu className="w-5 h-5 text-info" />
            </div>
            <div>
              <span className="text-[10px] font-mono text-textMuted uppercase tracking-wider block">Live Tick</span>
              <span className="text-xl font-mono font-bold text-textMain">Tick #{currentTick}</span>
            </div>
          </div>
        </div>

        {/* Loading State Skeleton */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="glass-panel p-6 h-64 animate-pulse border-border/40" />
            ))}
          </div>
        ) : flaggedCount === 0 ? (
          /* Empty / All Nominal State with Radar Sweep Animation */
          <div className="glass-panel p-12 text-center relative overflow-hidden border-healthy/20 bg-healthy/5">
            {/* Animated Radar Sweep Bar */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-healthy/10 to-transparent animate-radar-sweep pointer-events-none" />

            <div className="relative z-10 max-w-lg mx-auto space-y-3">
              <div className="w-16 h-16 rounded-full bg-healthy/20 border border-healthy/30 flex items-center justify-center mx-auto text-healthy animate-pulse">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-bold font-mono text-textMain tracking-wide uppercase">
                All Services Operating Nominally
              </h2>
              <p className="text-xs text-textMuted font-mono leading-relaxed">
                Chronos ML forecasting model detects zero imminent resource breaches across all microservice topologies. Sentinel radar continues active background sweep.
              </p>
              <div className="pt-2">
                <span className="px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-healthy/10 text-healthy border border-healthy/30 uppercase tracking-widest">
                  RADAR SWEEP ACTIVE • 0 BREACHES FORECASTED
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Main Service Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {serviceIds.map(sId => (
            <SentinelForecastCard
              key={sId}
              serviceId={sId}
              metrics={serviceGroups[sId]}
              currentTick={currentTick}
              onPreempt={handlePreempt}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
