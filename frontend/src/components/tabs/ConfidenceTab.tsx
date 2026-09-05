import React, { useEffect, useState, useRef } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import { TrendingUp, Award, Clock, Play, ShieldAlert, Activity, Wifi, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { io, Socket } from 'socket.io-client';
import { clsx } from 'clsx';

interface ConfidencePoint {
  tick: number;
  confidence: number;
  candidate: string;
}

const SOCKET_URL = 'http://localhost:3001';
const API_URL = 'http://localhost:3001/api/v1';

export const ConfidenceTab: React.FC = () => {
  const { bundle, startIncident } = useIncident();
  const [historyData, setHistoryData] = useState<ConfidencePoint[]>([]);
  const [isLive, setIsLive] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Bootstrap: fetch existing confidence history on mount
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_URL}/incident/confidence-history`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.confidenceHistory) && data.confidenceHistory.length > 0) {
            const formatted: ConfidencePoint[] = data.confidenceHistory.map((item: any) => ({
              tick: item.tick,
              confidence: Math.round((item.topCandidateConfidence || 0) * 100),
              candidate: item.topCandidateId || 'Unknown'
            }));
            setHistoryData(formatted);
          }
        }
      } catch (err) {
        console.error('Failed to fetch confidence history:', err);
      }
    };
    fetchHistory();
  }, []);

  // Real-time: subscribe to confidence:updated socket events
  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on('connect', () => setIsLive(true));
    socket.on('disconnect', () => setIsLive(false));
    socket.on('connect_error', () => setIsLive(false));

    socket.on('incident:state', () => {
      // New incident started — reset chart
      setHistoryData([]);
    });

    socket.on('confidence:updated', (wrapper: any) => {
      const point = wrapper.payload ?? wrapper;
      if (!point || typeof point.tick !== 'number') return;
      const formatted: ConfidencePoint = {
        tick: point.tick,
        confidence: Math.round((point.topCandidateConfidence || 0) * 100),
        candidate: point.topCandidateId || 'Unknown'
      };
      setHistoryData(prev => {
        // Deduplicate by tick
        const exists = prev.find(p => p.tick === formatted.tick);
        if (exists) return prev;
        return [...prev, formatted].sort((a, b) => a.tick - b.tick);
      });
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const topCandidate = bundle?.causalAnalysis?.topCandidate;
  const currentConfidence = topCandidate ? Math.round(topCandidate.confidence * 100) : 0;
  const peakConfidence = historyData.length > 0
    ? Math.max(...historyData.map(d => d.confidence), currentConfidence)
    : currentConfidence;
  const latestTick = bundle?.playback.tick ?? 0;

  // Determine chart domain max
  const yMax = Math.max(peakConfidence + 5, 100);

  if (!bundle || historyData.length === 0) {
    return (
      <div className="flex-1 p-8 overflow-y-auto bg-background flex flex-col items-center justify-center">
        <div className="max-w-md w-full glass-panel p-8 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <TrendingUp className="w-8 h-8 text-primary" />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold border',
              isLive ? 'bg-healthy/10 text-healthy border-healthy/20' : 'bg-surface text-textMuted border-border'
            )}>
              <Wifi className="w-3 h-3" />
              {isLive ? 'SOCKET CONNECTED — LISTENING' : 'CONNECTING...'}
            </span>
          </div>
          <h2 className="text-xl font-bold text-textMain mb-2 tracking-wide">AWAITING CONFIDENCE DATA</h2>
          <p className="text-sm text-textMuted mb-6 leading-relaxed">
            Start an incident simulation. Confidence data streams in real-time as the causal analyzer runs every 5 ticks.
          </p>
          <button
            onClick={() => startIncident()}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primaryHover text-white rounded-lg font-medium text-sm transition-colors shadow-lg"
          >
            <Play className="w-4 h-4 fill-white" />
            START INCIDENT SIMULATION
          </button>
        </div>
      </div>
    );
  }

  const latestPoint = historyData[historyData.length - 1];
  const leadingCandidate = latestPoint?.candidate ?? (topCandidate ? `${topCandidate.serviceId}/${topCandidate.resource}` : 'UNRESOLVED');

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Top Header Card */}
      <div className="glass-panel p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
              CONFIDENCE TRAJECTORY
            </span>
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-healthy/10 text-healthy border border-healthy/20">
              {historyData.length} POINTS CAPTURED
            </span>
            <span className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold border',
              isLive ? 'bg-info/10 text-info border-info/20' : 'bg-surface text-textMuted border-border'
            )}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', isLive ? 'bg-info animate-pulse' : 'bg-textMuted')} />
              {isLive ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-textMain tracking-tight">Statistical Confidence Over Time</h1>
          <p className="text-xs text-textMuted font-mono mt-1">Real-time Bayesian root cause likelihood curve across simulation ticks</p>
        </div>
        <button
          onClick={async () => {
            const res = await fetch(`${API_URL}/incident/confidence-history`);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data.confidenceHistory)) {
                setHistoryData(data.confidenceHistory.map((item: any) => ({
                  tick: item.tick,
                  confidence: Math.round((item.topCandidateConfidence || 0) * 100),
                  candidate: item.topCandidateId || 'Unknown'
                })));
              }
            }
          }}
          className="flex items-center gap-2 px-4 py-2 bg-surface border border-border hover:bg-surfaceHover text-textMuted hover:text-textMain rounded-lg text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          SYNC
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-5">
          <div className="flex items-center justify-between text-textMuted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Current Likelihood</span>
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="text-3xl font-bold text-primary font-mono">{currentConfidence}%</div>
          <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700"
              style={{ width: `${currentConfidence}%` }}
            />
          </div>
          <div className="text-xs text-textMuted mt-1">Active tick: #{latestTick}</div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-center justify-between text-textMuted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Peak Confidence</span>
            <Award className="w-4 h-4 text-healthy" />
          </div>
          <div className="text-3xl font-bold text-healthy font-mono">{peakConfidence}%</div>
          <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
            <div
              className="h-full bg-healthy rounded-full transition-all duration-700"
              style={{ width: `${peakConfidence}%` }}
            />
          </div>
          <div className="text-xs text-textMuted mt-1">Maximum certainty reached</div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-center justify-between text-textMuted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Leading Candidate</span>
            <ShieldAlert className="w-4 h-4 text-critical" />
          </div>
          <div className="text-lg font-bold text-textMain font-mono truncate">{leadingCandidate}</div>
          <div className="text-xs text-textMuted mt-1">Rank #1 hypothesis</div>
          <div className="text-xs text-textMuted mt-0.5">Tick window: #{historyData[0]?.tick ?? '—'} → #{latestTick}</div>
        </div>
      </div>

      {/* Main Chart Panel */}
      <div className="glass-panel p-6">
        <h3 className="font-semibold text-textMain text-sm uppercase tracking-wider mb-6 pb-3 border-b border-border flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Confidence Curve (% vs Tick)
          <span className="ml-auto text-xs font-mono text-textMuted">{historyData.length} sample points</span>
        </h3>

        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#404040" opacity={0.4} />
              <XAxis
                dataKey="tick"
                stroke="#A1A1AA"
                tick={{ fill: '#A1A1AA', fontSize: 11 }}
                label={{ value: 'Simulation Tick', position: 'insideBottom', offset: -12, fill: '#A1A1AA', fontSize: 11 }}
              />
              <YAxis
                domain={[0, yMax]}
                stroke="#A1A1AA"
                tick={{ fill: '#A1A1AA', fontSize: 11 }}
                label={{ value: 'Confidence %', angle: -90, position: 'insideLeft', fill: '#A1A1AA', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px', color: '#F9FAFB', fontSize: '12px' }}
                formatter={(val: any, name: string) => [`${val}%`, 'Confidence']}
                labelFormatter={(label) => `Tick ${label}`}
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload[0]) return null;
                  const data = payload[0].payload as ConfidencePoint;
                  return (
                    <div className="bg-surface border border-border rounded-lg p-3 text-xs font-mono shadow-lg">
                      <div className="text-textMuted mb-1">Tick {label}</div>
                      <div className="text-primary font-bold text-base">{data.confidence}%</div>
                      <div className="text-textMuted mt-1 truncate max-w-[180px]">{data.candidate}</div>
                    </div>
                  );
                }}
              />
              {/* Threshold reference line at 65% */}
              <ReferenceLine y={65} stroke="#10B981" strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: 'Diagnosis threshold', position: 'right', fill: '#10B981', fontSize: 10 }}
              />
              <Line
                type="monotone"
                dataKey="confidence"
                stroke="#4F46E5"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: '#4F46E5', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#10B981', strokeWidth: 2, stroke: '#fff' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Snapshot Table */}
      <div className="glass-panel p-5">
        <h3 className="font-semibold text-textMain text-sm uppercase tracking-wider mb-4 pb-3 border-b border-border">
          Confidence Snapshots ({historyData.length} samples)
        </h3>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-textMuted">
                <th className="pb-2 font-medium">Tick</th>
                <th className="pb-2 font-medium">Top Candidate</th>
                <th className="pb-2 font-medium">Confidence</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {historyData.slice().reverse().map((point, i) => (
                <tr key={point.tick} className={clsx('transition-colors', i === 0 ? 'bg-primary/5' : 'hover:bg-surfaceHover/50')}>
                  <td className="py-2 font-bold text-textMain">#{point.tick}</td>
                  <td className="py-2 text-info">{point.candidate}</td>
                  <td className="py-2">
                    <span className={clsx(
                      'font-bold',
                      point.confidence >= 65 ? 'text-healthy' : point.confidence >= 40 ? 'text-elevated' : 'text-textMuted'
                    )}>
                      {point.confidence}%
                    </span>
                  </td>
                  <td className="py-2">
                    <span className={clsx(
                      'px-1.5 py-0.5 rounded text-[10px] uppercase font-bold',
                      point.confidence >= 65 ? 'bg-healthy/20 text-healthy' :
                      point.confidence >= 40 ? 'bg-elevated/20 text-elevated' : 'bg-surface text-textMuted border border-border'
                    )}>
                      {point.confidence >= 65 ? 'CONFIDENT' : point.confidence >= 40 ? 'BUILDING' : 'WEAK'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
