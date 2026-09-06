import React, { useMemo } from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';

export const TelemetrySummary: React.FC = () => {
  const { bundle } = useIncident();
  
  // We want to show a quick sparkline for the top suspected service, or global latency
  const topCandidate = bundle?.causalAnalysis?.hypotheses?.[0];
  const serviceId = topCandidate ? topCandidate.serviceId : 'api_gateway';

  const chartData = useMemo(() => {
    if (!bundle) return [];
    return bundle.telemetryHistory.map(tick => ({
      tick: tick.tick,
      latency: tick.services.find(s => s.serviceId === serviceId)?.metrics.latencyMs || 0,
      queue: tick.services.find(s => s.serviceId === serviceId)?.metrics.queueDepth || 0,
    }));
  }, [bundle, serviceId]);

  if (!bundle || bundle.telemetryHistory.length === 0) return null;

  return (
    <div className="glass-panel p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold tracking-wide uppercase">{serviceId} Health</h3>
          <p className="text-xs text-textMuted">Recent telemetry trends</p>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-6 h-48">
        <div className="flex flex-col">
          <span className="text-[10px] text-textMuted uppercase tracking-widest mb-2">Latency (ms)</span>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F97316" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#F97316" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="tick" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#9CA3AF', fontSize: '12px' }}
                  itemStyle={{ color: '#F9FAFB', fontSize: '12px', fontFamily: 'monospace' }}
                />
                <Area type="monotone" dataKey="latency" stroke="#F97316" strokeWidth={2} fillOpacity={1} fill="url(#colorLatency)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-textMuted uppercase tracking-widest mb-2">Queue Depth</span>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorQueue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="tick" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#9CA3AF', fontSize: '12px' }}
                  itemStyle={{ color: '#F9FAFB', fontSize: '12px', fontFamily: 'monospace' }}
                />
                <Area type="stepAfter" dataKey="queue" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#colorQueue)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
