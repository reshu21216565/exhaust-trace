import React, { useEffect, useState } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import { TrendingUp, Award, Clock, Play, ShieldAlert, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export const ConfidenceTab: React.FC = () => {
  const { bundle, startIncident } = useIncident();
  const [historyData, setHistoryData] = useState<Array<{ tick: number; confidence: number; candidate: string }>>([]);

  useEffect(() => {
    const fetchConfidenceHistory = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/v1/incident/confidence-history');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.confidenceHistory)) {
            const formatted = data.confidenceHistory.map((item: any) => ({
              tick: item.tick,
              confidence: Math.round((item.topCandidateConfidence || 0) * 100),
              candidate: item.topCandidateId || 'Unknown'
            }));
            setHistoryData(formatted);
          }
        }
      } catch (err) {
        console.error("Failed to fetch confidence history:", err);
      }
    };

    fetchConfidenceHistory();
    const interval = setInterval(fetchConfidenceHistory, 2000);
    return () => clearInterval(interval);
  }, []);

  // Also fallback to bundle.causalAnalysis.confidenceHistory if present
  const confidenceHistoryFromBundle = bundle?.causalAnalysis?.confidenceHistory ?? [];
  const activeData = historyData.length > 0 
    ? historyData 
    : confidenceHistoryFromBundle.map(c => ({
        tick: c.tick,
        confidence: Math.round(c.topCandidateConfidence * 100),
        candidate: c.topCandidateId
      }));

  if (!bundle || activeData.length === 0) {
    return (
      <div className="flex-1 p-8 overflow-y-auto bg-background flex flex-col items-center justify-center">
        <div className="max-w-md w-full glass-panel p-8 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <TrendingUp className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-textMain mb-2 tracking-wide">NO CONFIDENCE DATA YET</h2>
          <p className="text-sm text-textMuted mb-6 leading-relaxed">
            No real-time confidence time series has been generated yet. Start an incident simulation to plot statistical confidence over simulation ticks.
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

  const topCandidate = bundle.causalAnalysis?.topCandidate;
  const currentConfidence = topCandidate ? Math.round(topCandidate.confidence * 100) : 0;
  const peakConfidence = Math.max(...activeData.map(d => d.confidence), currentConfidence);
  const latestTick = bundle.playback.tick ?? 0;

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Top Header Card */}
      <div className="glass-panel p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
              CONFIDENCE TRAJECTORY
            </span>
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-healthy/10 text-healthy border border-healthy/20">
              {activeData.length} POINTS CAPTURED
            </span>
          </div>
          <h1 className="text-2xl font-bold text-textMain tracking-tight">Statistical Confidence Over Time</h1>
          <p className="text-xs text-textMuted font-mono mt-1">Real-time Bayesian root cause likelihood curve across simulation ticks</p>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-5">
          <div className="flex items-center justify-between text-textMuted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Current Likelihood</span>
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-primary font-mono">{currentConfidence}%</div>
          <div className="text-xs text-textMuted mt-1">Active tick: #{latestTick}</div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-center justify-between text-textMuted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Peak Confidence</span>
            <Award className="w-4 h-4 text-healthy" />
          </div>
          <div className="text-2xl font-bold text-healthy font-mono">{peakConfidence}%</div>
          <div className="text-xs text-textMuted mt-1">Maximum certainty reached</div>
        </div>

        <div className="glass-panel p-5">
          <div className="flex items-center justify-between text-textMuted mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Leading Candidate</span>
            <ShieldAlert className="w-4 h-4 text-critical" />
          </div>
          <div className="text-xl font-bold text-textMain font-mono truncate">
            {topCandidate ? `${topCandidate.serviceId} (${topCandidate.resource})` : 'UNRESOLVED'}
          </div>
          <div className="text-xs text-textMuted mt-1">Rank #1 hypothesis</div>
        </div>
      </div>

      {/* Main Chart Panel */}
      <div className="glass-panel p-6">
        <h3 className="font-semibold text-textMain text-sm uppercase tracking-wider mb-6 pb-3 border-b border-border flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Confidence Curve (% vs Tick)
        </h3>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={activeData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#404040" opacity={0.5} />
              <XAxis dataKey="tick" stroke="#A1A1AA" tick={{ fill: '#A1A1AA', fontSize: 12 }} label={{ value: 'Simulation Tick', position: 'insideBottom', offset: -5, fill: '#A1A1AA', fontSize: 12 }} />
              <YAxis domain={[0, 100]} stroke="#A1A1AA" tick={{ fill: '#A1A1AA', fontSize: 12 }} label={{ value: 'Confidence %', angle: -90, position: 'insideLeft', fill: '#A1A1AA', fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px', color: '#F9FAFB', fontSize: '12px' }}
                formatter={(val: any) => [`${val}%`, 'Confidence']}
                labelFormatter={(label) => `Tick ${label}`}
              />
              <Line type="monotone" dataKey="confidence" stroke="#4F46E5" strokeWidth={3} dot={{ r: 4, fill: '#4F46E5' }} activeDot={{ r: 6, fill: '#10B981' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
