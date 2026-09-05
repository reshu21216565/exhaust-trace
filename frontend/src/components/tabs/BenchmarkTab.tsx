import React, { useState } from 'react';
import { Layers, Play, CheckCircle2, AlertTriangle, Clock, Zap, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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
  const [scenarioId, setScenarioId] = useState<string>('default_exhaustion');
  const [runCount, setRunCount] = useState<number>(5);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRunBenchmark = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId, runCount })
      });
      if (!res.ok) throw new Error(`Server returned status ${res.status}`);
      const data: BenchmarkResponse = await res.json();
      setBenchmarkResult(data);
    } catch (err: any) {
      console.error("Benchmark execution failed:", err);
      setErrorMsg(err.message || "Failed to execute benchmark run suite.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Top Header & Controls Panel */}
      <div className="glass-panel p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
                MULTI-RUN BENCHMARK SUITE
              </span>
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-info/10 text-info border border-info/20">
                ISOLATED PARALLEL SIMULATION
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
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary"
            >
              <option value="default_exhaustion">default_exhaustion (records/MEMORY)</option>
              <option value="custom_portal_cpu">custom_portal_cpu (portal/CPU)</option>
              <option value="custom_records_connections">custom_records_conn (records/CONNECTIONS)</option>
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
                    "px-3 py-2 text-xs font-mono font-bold rounded-lg border transition-colors flex-1",
                    runCount === count
                      ? "bg-primary text-white border-primary"
                      : "bg-surface text-textMuted border-border hover:bg-surfaceHover hover:text-textMain"
                  )}
                >
                  {count}x
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleRunBenchmark}
              disabled={isRunning}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primaryHover disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors shadow-lg"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  EXECUTING BENCHMARKS...
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
            Select your scenario and run count above, then click <strong>"RUN BENCHMARK"</strong> to launch isolated scenario iterations and compile accuracy metrics.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Banner */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Accuracy Banner</div>
              <div className={clsx("text-3xl font-bold font-mono", benchmarkResult.accuracyPercent >= 80 ? "text-healthy" : "text-elevated")}>
                {benchmarkResult.accuracyPercent}%
              </div>
              <div className="text-xs text-textMuted mt-1">Identified true root cause</div>
            </div>

            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Avg Time to Diagnosis</div>
              <div className="text-3xl font-bold text-info font-mono">{benchmarkResult.avgTicksToDiagnosis} ticks</div>
              <div className="text-xs text-textMuted mt-1">Mean simulation ticks</div>
            </div>

            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Fastest Diagnosis</div>
              <div className="text-3xl font-bold text-healthy font-mono">{benchmarkResult.fastestRunTicks} ticks</div>
              <div className="text-xs text-textMuted mt-1">Best run latency</div>
            </div>

            <div className="glass-panel p-5">
              <div className="text-xs font-medium text-textMuted uppercase mb-1">Total Scenario Runs</div>
              <div className="text-3xl font-bold text-textMain font-mono">{benchmarkResult.totalRuns}</div>
              <div className="text-xs text-textMuted mt-1">Completed iterations</div>
            </div>
          </div>

          {/* Time-to-Diagnosis Bar Chart */}
          <div className="glass-panel p-6">
            <h3 className="font-semibold text-textMain text-sm uppercase tracking-wider mb-6 pb-3 border-b border-border flex items-center gap-2">
              <Clock className="w-4 h-4 text-info" />
              Time-to-Diagnosis Per Run (Ticks)
            </h3>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={benchmarkResult.runs.map(r => ({ run: `Run #${r.runNumber}`, ticks: r.ticksToDiagnosis, confidence: r.confidence }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#404040" opacity={0.5} />
                  <XAxis dataKey="run" stroke="#A1A1AA" tick={{ fill: '#A1A1AA', fontSize: 12 }} />
                  <YAxis stroke="#A1A1AA" tick={{ fill: '#A1A1AA', fontSize: 12 }} label={{ value: 'Ticks', angle: -90, position: 'insideLeft', fill: '#A1A1AA', fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#171717', borderColor: '#404040', borderRadius: '8px', color: '#F9FAFB', fontSize: '12px' }}
                    formatter={(val: any) => [`${val} ticks`, 'Time to Diagnosis']}
                  />
                  <Bar dataKey="ticks" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
                    <th className="pb-2 font-medium">Seed</th>
                    <th className="pb-2 font-medium">Top Candidate</th>
                    <th className="pb-2 font-medium">Confidence</th>
                    <th className="pb-2 font-medium">Ticks</th>
                    <th className="pb-2 font-medium">Verdict Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {benchmarkResult.runs.map((r) => (
                    <tr key={r.runNumber} className="hover:bg-surfaceHover/50 transition-colors">
                      <td className="py-2.5 font-bold text-textMain">Run #{r.runNumber}</td>
                      <td className="py-2.5 text-textMuted">{r.seed}</td>
                      <td className="py-2.5 text-info font-bold">{r.topCandidateId}</td>
                      <td className="py-2.5 text-healthy font-bold">{r.confidence}%</td>
                      <td className="py-2.5 text-textMain">{r.ticksToDiagnosis}</td>
                      <td className="py-2.5">
                        <span className={clsx(
                          "px-2 py-0.5 rounded text-[10px] uppercase font-bold flex items-center gap-1 w-fit",
                          r.isCorrect ? "bg-healthy/20 text-healthy border border-healthy/30" : "bg-critical/20 text-critical border border-critical/30"
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
