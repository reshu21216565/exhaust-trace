/**
 * Sentinel ForecastEngine
 * ML-powered early-warning time-series forecasting engine using Hugging Face's amazon/chronos-t5-small.
 * Supports HF Router endpoints, quantile extraction (q10, median, q90), and statistical fallback.
 */

export interface ForecastResult {
  median: number[];
  q10: number[];
  q90: number[];
  modelUsed: 'chronos-t5-small' | 'holt-linear-fallback';
}

export class ForecastEngine {
  /**
   * Forecast time-series forward by `horizon` ticks using Chronos-t5-small with Holt fallback.
   */
  public async forecastMetric(history: number[], horizon = 20): Promise<ForecastResult> {
    const safeHistory = (history && history.length > 0) ? history : [0.2, 0.22, 0.21, 0.25];
    const apiKey = process.env.HUGGINGFACE_API_KEY;

    if (apiKey && apiKey !== 'hf_demo_placeholder') {
      // Try HF Router endpoint first, then legacy endpoint
      const endpoints = [
        "https://router.huggingface.co/hf-inference/models/amazon/chronos-t5-small",
        "https://api-inference.huggingface.co/models/amazon/chronos-t5-small"
      ];

      for (const url of endpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              inputs: safeHistory,
              parameters: { prediction_length: horizon },
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const json = await response.json();
            const extracted = this.extractQuantilesFromHfResponse(json, safeHistory, horizon);
            if (extracted) {
              return {
                ...extracted,
                modelUsed: 'chronos-t5-small',
              };
            }
          }
        } catch (err: any) {
          // try next endpoint or fallback
        }
      }
    }

    return {
      ...this.calculateHoltFallback(safeHistory, horizon),
      modelUsed: 'holt-linear-fallback',
    };
  }

  /**
   * Extract median, 10th percentile, and 90th percentile from HF Chronos response shapes.
   */
  private extractQuantilesFromHfResponse(json: any, history: number[], horizon: number): { median: number[]; q10: number[]; q90: number[] } | null {
    try {
      // Shape 1: [{ mean: [...], quantiles: { "0.1": [...], "0.5": [...], "0.9": [...] } }]
      const item = Array.isArray(json) ? json[0] : json;
      if (item && item.quantiles) {
        const q10 = item.quantiles['0.1'] || item.quantiles['10%'] || item.quantiles['0.10'];
        const median = item.quantiles['0.5'] || item.quantiles['50%'] || item.quantiles['0.50'] || item.mean;
        const q90 = item.quantiles['0.9'] || item.quantiles['90%'] || item.quantiles['0.90'];

        if (Array.isArray(median) && median.length > 0) {
          const mArr = median.slice(0, horizon);
          const q10Arr = (Array.isArray(q10) ? q10 : mArr.map(v => v * 0.9)).slice(0, horizon);
          const q90Arr = (Array.isArray(q90) ? q90 : mArr.map(v => v * 1.1)).slice(0, horizon);
          return { median: mArr, q10: q10Arr, q90: q90Arr };
        }
      }

      // Shape 2: Array of numeric arrays (sample trajectories) [[t1_s1, t2_s1...], [t1_s2, t2_s2...]]
      if (Array.isArray(json) && Array.isArray(json[0]) && typeof json[0][0] === 'number') {
        const samplesCount = json.length;
        const stepsCount = json[0].length;
        const median: number[] = [];
        const q10: number[] = [];
        const q90: number[] = [];

        for (let step = 0; step < Math.min(stepsCount, horizon); step++) {
          const stepVals = json.map(sample => sample[step]).sort((a, b) => a - b);
          const p10Idx = Math.floor(samplesCount * 0.1);
          const p50Idx = Math.floor(samplesCount * 0.5);
          const p90Idx = Math.min(Math.floor(samplesCount * 0.9), samplesCount - 1);

          q10.push(stepVals[p10Idx] ?? stepVals[0]);
          median.push(stepVals[p50Idx] ?? stepVals[0]);
          q90.push(stepVals[p90Idx] ?? stepVals[samplesCount - 1]);
        }

        return { median, q10, q90 };
      }
    } catch (e) {
      console.warn('[Sentinel] Failed to parse HF response shape:', e);
    }
    return null;
  }

  /**
   * Holt's Linear Exponential Smoothing with expanding uncertainty confidence bounds.
   */
  private calculateHoltFallback(history: number[], horizon: number): { median: number[]; q10: number[]; q90: number[] } {
    const alpha = 0.4;
    const beta = 0.3;

    let level = history[0] ?? 0.2;
    let trend = (history.length > 1) ? (history[history.length - 1] - history[0]) / history.length : 0;

    for (let i = 1; i < history.length; i++) {
      const val = history[i];
      const prevLevel = level;
      level = alpha * val + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    const median: number[] = [];
    const q10: number[] = [];
    const q90: number[] = [];

    // Calculate historical variance for confidence width
    let sumSq = 0;
    for (const val of history) {
      sumSq += Math.pow(val - level, 2);
    }
    const stdDev = Math.sqrt(sumSq / Math.max(1, history.length));

    let currentForecastLevel = level;

    for (let h = 1; h <= horizon; h++) {
      const dampFactor = Math.pow(0.96, h);
      currentForecastLevel = currentForecastLevel + (trend * dampFactor);

      const spread = Math.max(0.02, stdDev * (1 + 0.08 * h));

      const med = Math.max(0, currentForecastLevel);
      const low = Math.max(0, med - spread * 1.28);
      const high = med + spread * 1.28;

      median.push(Number(med.toFixed(4)));
      q10.push(Number(low.toFixed(4)));
      q90.push(Number(high.toFixed(4)));
    }

    return { median, q10, q90 };
  }
}

export const globalForecastEngine = new ForecastEngine();
