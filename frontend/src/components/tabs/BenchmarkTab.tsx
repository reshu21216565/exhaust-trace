import React, { useState, useRef } from 'react';
import { Layers, Play, CheckCircle2, AlertTriangle, Clock, Zap, Loader2, BarChart2, Target, TrendingUp } from 'lucide-react';
import { clsx } from 'clsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

const SCENARIOS = [
  { id: 'records_memory_critical',          label: 'records / MEMORY / CRITICAL' },
  { id: 'records_cpu_critical',             label: 'records / CPU / CRITICAL' },
  { id: 'records_connections_critical',     label: 'records / CONNECTIONS / CRITICAL' },
  { id: 'records_workers_critical',         label: 'records / WORKERS / CRITICAL' },
  { id: 'appointment_memory_critical',      label: 'appointment / MEMORY / CRITICAL' },
  { id: 'appointment_cpu_critical',         label: 'appointment / CPU / CRITICAL' },
  { id: 'appointment_connections_critical', label: 'appointment / CONNECTIONS / CRITICAL' },
  { id: 'appointment_workers_critical',     label: 'appointment / WORKERS / CRITICAL' },
  { id: 'default_exhaustion',              label: 'default_exhaustion (records/MEMORY)' },
  { id: 'custom_portal_cpu',               label: 'portal / CPU / CRITICAL' },
  { id: 'custom_records_connections',      label: 'records / CONNECTIONS / HIGH' },
];

interface BenchmarkRunResult {
  runNumber: number;
  seed: string;
  ticksToDiagnosis: number;
  topCandidateId: string;
  confidence: number;
  isCorrect: boolean;
  status: string;
}

interface BenchmarkResponse {
  scenarioId: string;
  totalRuns: number;
  accuracyPercent: number;
  avgTicksToDiagnosis: number;
  fastestRunTicks: number;
  slowestRunTicks: number;
  runs: BenchmarkRunResult[];
}

export const BenchmarkTab: React.FC = () => {
  const [scenarioId, setScenarioId] = useState<string>('records_memory_critical');
  const [runCount, setRunCount] = useState<number>(5);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleRunBenchmark = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    setBenchmarkResult(null);
    setElapsedMs(null);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 200);

    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId, runCount })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message || `Server returned status ${res.status}`);
      }
      const data: BenchmarkResponse = await res.json();
      setBenchmarkResult(data);
    } catch (err: any) {
      console.error('Benchmark execution failed:', err);
      setErrorMsg(err.message || 'Failed to execute benchmark run suite.');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedMs(Date.now() - startTime);
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Top Header & Controls Panel */}
      <div className="glass-panel p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
                MULTI-RUN BENCHMARK SUITE
              </span>
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-info/10 text-info border border-info/20">
                ISOLATED PARALLEL SIMULATION
              </span>
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-healthy/10 text-healthy border border-healthy/20">
                11 SCENARIOS AVAILABLE
              </span>
            </div>
            <h1 className="text-2xl font-bold text-textMain tracking-tight">Causal Debugger Benchmark Mode</h1>
            <p className="text-xs text-textMuted font-mono mt-1">Execute batch Monte-Carlo incident scenarios to measure root cause precision and diagnosis latency</p>
          </div>
        </div>

        {/* Configuration Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6">
          <div>
            <label className="block text-xs font-medium text-textMuted uppercase mb-2">Target Scenario</label>
            <select
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              disabled={isRunning}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary font-mono"
            >
              {SCENARIOS.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-textMuted uppercase mb-2">Run Count</label>
            <div className="flex items-center gap-2">
              {[3, 5, 10, 15, 20].map((count) => (
                <button
                  key={count}
                  onClick={() => setRunCount(count)}
                  disabled={isRunning}
                  className={clsx(
                    'px-3 py-2 text-xs font-mono font-bold rounded-lg border transition-colors flex-1',
                    runCount === count
                      ? 'bg-primary text-white border-primary'
                      : 'bg-surface text-textMuted border-border hover:bg-surfaceHover hover:text-textMain'
                  )}
                >
                  {count}x
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end">
            <button
              id="benchmark-run-btn"
              onClick={handleRunBenchmark}
              disabled={isRunning}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primaryHover disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors shadow-lg"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  RUNNING ({elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : '...'})
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  RUN BENCHMARK ({runCount} RUNS)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Progress bar while running */}
        {isRunning && (
          <div className="mt-4 p-3 bg-info/5 border border-info/20 rounded-lg">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-info font-mono font-bold">RUNNING {runCount} ISOLATED SIMULATIONS...</span>
              <span className="text-textMuted font-mono">{elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s elapsed` : ''}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface overflow-hidden">
              <div className="h-full bg-info rounded-full animate-pulse" style={{ width: '100%' }} />
            </div>
            <p className="text-[10px] text-textMuted mt-2 font-mono">Each run spins up an isolated simulation world, injects the failure, and measures ticks until confident diagnosis.</p>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3 bg-critical/10 border border-critical/20 rounded-lg text-xs text-critical flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errorMsg}
          </div>
        )}
      </div>

      {/* Main Results / Empty State */}
      {!benchmarkResult ? (
        <div className="glass-panel p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <Layers className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-textMain mb-2 tracking-wide">BENCHMARK SUITE READY</h2>
          <p className="text-sm text-textMuted max-w-md mb-6 leading-relaxed">
            Select your scenario and run count above, then click <strong>"RUN BENCHMARK"</strong> to launch isolated
            Monte-Carlo iterations and compile root cause precision metrics.
          </p>
          <div className="grid grid-cols-3 gap-4 w-full max-w-sm text-xs text-textMuted">
            <div className="glass-panel p-3 text-center">
              <Target className="w-5 h-5 mx-auto mb-1 text-primary" />
              <div>Accuracy</div>
            </div>
            <div className="glass-panel p-3 text-center">
              <Clock className="w-5 h-5 mx-auto mb-1 text-info" />
              <div>Latency</div>
            </div>
            <div className="glass-panel p-3 text-center">
              <TrendingUp className="w-5 h-5 mx-auto mb-1 text-healthy" />
              <div>Precision</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header banner */}
          <div className="glass-panel p-4 flex items-center justify-between border-l-4 border-l-primary">
            <div>
              <div className="text-xs text-textMuted font-mono">BENCHMARK COMPLETED</div>
              <div className="text-sm font-bold text-textMain font-mono mt-0.5">
                Scenario: <span className="text-primary">{benchmarkResult.scenarioId}</span> — {benchmarkResult.totalRuns} isolated runs
              </div>
            </div>
            {elapsedMs != null && (
              <div className="text-xs text-textMuted font-mono">
                Completed in {(elapsedMs / 1000).toFixed(1)}s
              </div>
            )}
          </div>

          {/* Summary Banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Accuracy</div>
              <div className={clsx('text-3xl font-bold font-mono', benchmarkResult.accuracyPercent >= 80 ? 'text-healthy' : benchmarkResult.accuracyPercent >= 60 ? 'text-elevated' : 'text-critical')}>
                {benchmarkResult.accuracyPercent}%
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
                <div
                  className={clsx('h-full rounded-full transition-all', benchmarkResult.accuracyPercent >= 80 ? 'bg-healthy' : benchmarkResult.accuracyPercent >= 60 ? 'bg-elevated' : 'bg-critical')}
                  style={{ width: `${benchmarkResult.accuracyPercent}%` }}
                />
              </div>
              <div className="text-xs text-textMuted mt-1">Identified true root cause</div>
            </div>

            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Avg Diagnosis</div>
              <div className="text-3xl font-bold text-info font-mono">{benchmarkResult.avgTicksToDiagnosis}</div>
              <div className="text-xs text-textMuted mt-1">Mean ticks to confident ID</div>
            </div>

            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Fastest Run</div>
              <div className="text-3xl font-bold text-healthy font-mono">{benchmarkResult.fastestRunTicks} <span className="text-sm">ticks</span></div>
              <div className="text-xs text-textMuted mt-1">Best run latency</div>
            </div>

            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Total Runs</div>
              <div className="text-3xl font-bold text-textMain font-mono">{benchmarkResult.totalRuns}</div>
              <div className="text-xs text-textMuted mt-1">
                {benchmarkResult.runs.filter(r => r.isCorrect).length} correct / {benchmarkResult.runs.filter(r => !r.isCorrect).length} incorrect
              </div>
            </div>
          </div>

          {/* Time-to-Diagnosis Bar Chart */}
          <div className="glass-panel p-6">
            <h3 className="font-semibold text-textMain text-sm uppercase tracking-wider mb-6 pb-3 border-b border-border flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-info" />
              Time-to-Diagnosis Per Run (Ticks)
            </h3>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={benchmarkResult.runs.map(r => ({
                  run: `#${r.runNumber}`,
                  ticks: r.ticksToDiagnosis,
                  correct: r.isCorrect
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#404040" opacity={0.5} />
                  <XAxis dataKey="run" stroke="#A1A1AA" tick={{ fill: '#A1A1AA', fontSize: 12 }} />
                  <YAxis stroke="#A1A1AA" tick={{ fill: '#A1A1AA', fontSize: 12 }} label={{ value: 'Ticks', angle: -90, position: 'insideLeft', fill: '#A1A1AA', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px', color: '#F9FAFB', fontSize: '12px' }}
                    formatter={(val: any, name: string) => [`${val} ticks`, 'Time to Diagnosis']}
                  />
                  <Bar dataKey="ticks" radius={[4, 4, 0, 0]}>
                    {benchmarkResult.runs.map((r, i) => (
                      <Cell key={i} fill={r.isCorrect ? '#4F46E5' : '#EF4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-textMuted">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary inline-block" /> Correct Root Identified</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-critical inline-block" /> Incorrect / Unresolved</span>
            </div>
          </div>

          {/* Results Table */}
          <div className="glass-panel p-5">
            <h3 className="font-semibold text-textMain text-sm uppercase tracking-wider mb-4 pb-3 border-b border-border">
              Iteration Results Detail ({benchmarkResult.runs.length} Runs)
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-textMuted">
                    <th className="pb-2 font-medium">Run #</th>
                    <th className="pb-2 font-medium">Top Candidate</th>
                    <th className="pb-2 font-medium">Confidence</th>
                    <th className="pb-2 font-medium">Ticks</th>
                    <th className="pb-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {benchmarkResult.runs.map((r) => (
                    <tr key={r.runNumber} className="hover:bg-surfaceHover/50 transition-colors">
                      <td className="py-2.5 font-bold text-textMain">Run #{r.runNumber}</td>
                      <td className="py-2.5 text-info">{r.topCandidateId}</td>
                      <td className="py-2.5">
                        <span className={clsx('font-bold', r.confidence >= 65 ? 'text-healthy' : 'text-elevated')}>{r.confidence}%</span>
                      </td>
                      <td className="py-2.5 text-textMain font-bold">{r.ticksToDiagnosis}</td>
                      <td className="py-2.5">
                        <span className={clsx(
                          'px-2 py-0.5 rounded text-[10px] uppercase font-bold flex items-center gap-1 w-fit',
                          r.isCorrect ? 'bg-healthy/20 text-healthy border border-healthy/30' : 'bg-critical/20 text-critical border border-critical/30'
                        )}>
                          {r.isCorrect ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                          {r.isCorrect ? 'CORRECT ROOT' : 'INCORRECT'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
