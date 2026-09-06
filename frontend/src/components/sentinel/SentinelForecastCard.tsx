/**
 * SentinelForecastCard
 * Displays a single service's 4 metrics (CPU, Memory, Connections, Workers)
 * with sparkline forecast charts, confidence bands, animated strokes,
 * real-time breach countdown, and pre-emptive relief action with defuse animation.
 */

import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, Zap, AlertTriangle, CheckCircle2, Loader2, Radar, Flame } from 'lucide-react';
import { clsx } from 'clsx';

export interface MetricForecastData {
  serviceId: string;
  metric: 'cpu' | 'memory' | 'connections' | 'workers';
  currentValue: number;
  threshold: number;
  history: number[];
  forecast: {
    median: number[];
    q10: number[];
    q90: number[];
  };
  isCurrentBreach?: boolean;
  breachStatus?: 'ACTIVE_BREACH' | 'FORECASTED_BREACH' | 'NOMINAL';
  breachExpectedAtTick: number | null;
  ticksUntilBreach: number | null;
  confidence: 'low' | 'medium' | 'high';
  modelUsed: string;
}

interface SentinelForecastCardProps {
  serviceId: string;
  metrics: MetricForecastData[];
  currentTick: number;
  onPreempt: (serviceId: string, metric: string) => Promise<void>;
}

export const SentinelForecastCard: React.FC<SentinelForecastCardProps> = ({
  serviceId,
  metrics,
  currentTick: _currentTick,
  onPreempt,
}) => {
  const [preemptingMetric, setPreemptingMetric] = useState<string | null>(null);
  const [defusedMetrics, setDefusedMetrics] = useState<Set<string>>(new Set());

  // Check if any metric on this service is active or forecasted for breach
  const flaggedMetrics = metrics.filter(
    m => (m.breachExpectedAtTick !== null || m.isCurrentBreach) && !defusedMetrics.has(m.metric)
  );

  const hasActiveBreach = flaggedMetrics.some(m => m.isCurrentBreach || m.currentValue >= m.threshold);
  const isFlagged = flaggedMetrics.length > 0;

  const earliestBreach = flaggedMetrics.reduce<MetricForecastData | null>((earliest, curr) => {
    if (!earliest) return curr;
    if ((curr.ticksUntilBreach ?? 999) < (earliest.ticksUntilBreach ?? 999)) return curr;
    return earliest;
  }, null);

  const handlePreemptClick = async (metric: string) => {
    setPreemptingMetric(metric);
    try {
      await onPreempt(serviceId, metric);
      setDefusedMetrics(prev => new Set(prev).add(metric));
    } finally {
      setPreemptingMetric(null);
    }
  };

  return (
    <div
      className={clsx(
        'glass-panel p-5 rounded-xl border transition-all duration-700 relative overflow-hidden',
        hasActiveBreach
          ? 'border-red-500 bg-red-500/10 shadow-lg shadow-red-500/20'
          : isFlagged
          ? 'border-amber-500/60 shadow-lg shadow-amber-500/10 animate-pulse-slow'
          : 'border-border/60 hover:border-primary/40'
      )}
    >
      {/* Background threat aura */}
      {hasActiveBreach ? (
        <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 via-transparent to-red-500/10 pointer-events-none" />
      ) : isFlagged ? (
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-amber-500/5 pointer-events-none" />
      ) : null}

      {/* Card Header */}
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs font-mono border',
              hasActiveBreach
                ? 'bg-red-500/20 text-red-400 border-red-500/40'
                : isFlagged
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-primary/10 text-primary border-primary/30'
            )}
          >
            {serviceId.slice(0, 3).toUpperCase()}
          </div>
          <div>
            <h3 className="text-sm font-bold text-textMain tracking-wide uppercase font-mono">
              {serviceId}
            </h3>
            <span className="text-[10px] text-textMuted font-mono">
              Microservice Container
            </span>
          </div>
        </div>

        {/* Status Badge */}
        {hasActiveBreach ? (
          <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/40 px-3 py-1 rounded-full">
            <Flame className="w-3.5 h-3.5 text-red-400 animate-pulse" />
            <span className="text-[11px] font-mono font-bold text-red-300">
              ACTIVE CRITICAL BREACH
            </span>
          </div>
        ) : isFlagged && earliestBreach ? (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
            <span className="text-[11px] font-mono font-bold text-amber-300">
              FORECASTED BREACH IN ~{earliestBreach.ticksUntilBreach} TICKS
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-healthy/10 border border-healthy/20 px-2.5 py-1 rounded-full text-healthy text-[10px] font-mono font-bold">
            <ShieldCheck className="w-3 h-3" />
            NOMINAL
          </div>
        )}
      </div>

      {/* 4 Sparkline Forecast Charts Stacked Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-3 relative z-10">
        {metrics.map(mData => (
          <MetricForecastChart
            key={mData.metric}
            data={mData}
            isDefused={defusedMetrics.has(mData.metric)}
            isPreempting={preemptingMetric === mData.metric}
            onPreempt={() => handlePreemptClick(mData.metric)}
          />
        ))}
      </div>
    </div>
  );
};

interface MetricForecastChartProps {
  data: MetricForecastData;
  isDefused: boolean;
  isPreempting: boolean;
  onPreempt: () => void;
}

const MetricForecastChart: React.FC<MetricForecastChartProps> = ({
  data,
  isDefused,
  isPreempting,
  onPreempt,
}) => {
  const { metric, currentValue, threshold, history, forecast, breachExpectedAtTick, ticksUntilBreach, confidence, isCurrentBreach } = data;
  const isActiveBreach = (isCurrentBreach || currentValue >= threshold) && !isDefused;
  const isForecastedBreach = breachExpectedAtTick !== null && !isActiveBreach && !isDefused;

  // SVG dimensions
  const width = 260;
  const height = 64;
  const padding = 6;

  const histLen = history.length;
  const foreLen = forecast.median.length;
  const totalPoints = histLen + foreLen;

  let maxVal = Math.max(
    threshold * 1.15,
    ...history,
    ...forecast.q90
  );
  if (metric === 'cpu' || metric === 'memory') maxVal = Math.max(maxVal, 1.0);
  if (maxVal <= 0) maxVal = 1;

  const getX = (index: number) => padding + (index / (totalPoints - 1)) * (width - 2 * padding);
  const getY = (val: number) => height - padding - (Math.min(val, maxVal) / maxVal) * (height - 2 * padding);

  const historyPath = history.map((val, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(val)}`).join(' ');

  const forecastPoints = forecast.median.map((val, idx) => {
    const ptIdx = histLen - 1 + idx + 1;
    return `${idx === 0 ? `M ${getX(histLen - 1)} ${getY(history[histLen - 1] ?? val)} L` : 'L'} ${getX(ptIdx)} ${getY(val)}`;
  }).join(' ');

  const q90Points = forecast.q90.map((val, idx) => `${getX(histLen + idx)},${getY(val)}`).join(' ');
  const q10Points = forecast.q10.map((val, idx) => `${getX(histLen + idx)},${getY(val)}`).reverse().join(' ');
  const startPt = `${getX(histLen - 1)},${getY(history[histLen - 1] ?? forecast.median[0])}`;
  const bandPolygon = `${startPt} ${q90Points} ${q10Points}`;

  const thresholdY = getY(threshold);
  const nowX = getX(histLen - 1);

  const formatDisplayVal = (val: number) => {
    if (metric === 'cpu' || metric === 'memory') return `${(val * 100).toFixed(0)}%`;
    if (metric === 'workers') return `${val.toFixed(0)}%`;
    return `${val.toFixed(0)}`;
  };

  return (
    <div
      className={clsx(
        'p-3 rounded-lg border bg-surface/60 transition-all relative overflow-hidden',
        isActiveBreach
          ? 'border-red-500/60 bg-red-500/10 shadow-sm'
          : isForecastedBreach
          ? 'border-amber-500/40 bg-amber-500/5 shadow-sm'
          : isDefused
          ? 'border-healthy/30 bg-healthy/5'
          : 'border-border/50 hover:border-border'
      )}
    >
      {/* Metric Header */}
      <div className="flex items-center justify-between text-xs font-mono mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-bold uppercase text-textMain">{metric}</span>
          <span className={clsx("text-[10px]", isActiveBreach ? "text-red-400 font-bold" : "text-textMuted")}>
            {formatDisplayVal(currentValue)}
          </span>
        </div>

        {isActiveBreach ? (
          <button
            onClick={onPreempt}
            disabled={isPreempting}
            className="px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 font-mono font-bold text-[10px] flex items-center gap-1 transition-all shadow-md animate-pulse"
          >
            {isPreempting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 fill-current" />}
            IMMEDIATE RELIEF
          </button>
        ) : isForecastedBreach ? (
          <button
            onClick={onPreempt}
            disabled={isPreempting}
            className="px-2 py-0.5 rounded bg-amber-500 text-black hover:bg-amber-400 font-mono font-bold text-[10px] flex items-center gap-1 transition-all shadow-md animate-pulse"
          >
            {isPreempting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 fill-current" />}
            PRE-EMPT
          </button>
        ) : isDefused ? (
          <span className="px-2 py-0.5 rounded bg-healthy/20 text-healthy border border-healthy/30 font-mono text-[9px] font-bold flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5" /> DEFUSED
          </span>
        ) : (
          <span className="text-[9px] font-mono text-textMuted uppercase">
            {confidence} conf
          </span>
        )}
      </div>

      {/* SVG Chart */}
      <div className="relative w-full h-16">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {/* Critical Threshold Line */}
          <line
            x1={padding}
            y1={thresholdY}
            x2={width - padding}
            y2={thresholdY}
            stroke="#ef4444"
            strokeDasharray="3 3"
            strokeWidth="1"
            opacity="0.6"
          />

          {/* Confidence Band Gradient Spread */}
          <polygon
            points={bandPolygon}
            fill={isActiveBreach ? '#ef4444' : (isForecastedBreach ? '#f59e0b' : '#22d3ee')}
            opacity="0.15"
          />

          {/* Historical Metric Line */}
          <path
            d={historyPath}
            fill="none"
            stroke={isActiveBreach ? '#ef4444' : '#22d3ee'}
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Forecasted Line */}
          <path
            d={forecastPoints}
            fill="none"
            stroke={isActiveBreach ? '#ef4444' : (isForecastedBreach ? '#f59e0b' : '#22d3ee')}
            strokeWidth="2"
            strokeDasharray="4 4"
            className="animate-pulse"
          />

          {/* NOW Vertical Marker Playhead */}
          <line
            x1={nowX}
            y1={padding}
            x2={nowX}
            y2={height - padding}
            stroke="#22d3ee"
            strokeWidth="1.5"
            opacity="0.8"
          />
          <circle cx={nowX} cy={getY(currentValue)} r="3.5" fill={isActiveBreach ? '#ef4444' : '#22d3ee'} className="animate-ping" />
          <circle cx={nowX} cy={getY(currentValue)} r="2.5" fill={isActiveBreach ? '#ef4444' : '#22d3ee'} />
        </svg>

        {/* Floating Now Label */}
        <div
          className="absolute top-0 text-[8px] font-mono text-primary font-bold tracking-widest pointer-events-none"
          style={{ left: `${(nowX / width) * 100}%`, transform: 'translateX(-50%)' }}
        >
          NOW
        </div>
      </div>

      {/* Footer info */}
      {isActiveBreach ? (
        <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-red-400 font-bold border-t border-red-500/30 pt-1">
          <span>CRITICAL THRESHOLD BREACH ACTIVE</span>
          <span className="tabular-nums">AT TICK #{breachExpectedAtTick}</span>
        </div>
      ) : isForecastedBreach && ticksUntilBreach ? (
        <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-amber-400 font-bold border-t border-amber-500/20 pt-1">
          <span>FORECASTED BREACH AT TICK #{breachExpectedAtTick}</span>
          <span className="tabular-nums">in {ticksUntilBreach} ticks</span>
        </div>
      ) : null}
    </div>
  );
};
