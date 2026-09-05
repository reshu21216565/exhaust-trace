import React from 'react';
import { MatrixRain } from '../components/MatrixRain';
import { ThemeToggle } from '../components/ThemeToggle';

const TICKER_ITEMS = [
  "SYSTEM STATUS: OPERATIONAL",
  "MONITORING 12 SERVICES",
  "0 ACTIVE INCIDENTS",
  "LAST SCAN: 2.3s AGO",
  "CAUSAL ENGINE: READY",
  "TELEMETRY STREAM: LIVE",
  "ENCRYPTION: AES-256",
  "UPTIME: 99.97%",
  "NODES TRACKED: 847",
  "ANALYSIS LATENCY: 340ms",
  "PREDICTION ACCURACY: 96.4%",
  "BUILD 2.1.0",
];

const TICKER_TEXT = `${TICKER_ITEMS.join("  //  ")}  //  `;

interface LandingPageProps {
  onEnter: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnter }) => {
  return (
    <div className="relative min-h-screen w-full flex flex-col justify-between overflow-hidden bg-[#0a0e14] text-[#F1F5F9] select-none">
      {/* Background Matrix Rain */}
      <MatrixRain />

      {/* Vignette Overlay */}
      <div className="pointer-events-none fixed inset-0 z-[1] bg-vignette" />

      {/* Header — Header contains only Title and Theme Toggle */}
      <header className="relative z-10 w-full px-6 py-6 sm:px-12 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-lg tracking-[0.18em] uppercase text-[#F1F5F9] font-light">
            ExhaustTrace
          </span>
        </div>
        <ThemeToggle />
      </header>

      {/* Centered Translucent Glass Hero Panel */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <section className="glass-panel-translucent relative z-10 w-full max-w-2xl px-6 py-8 sm:px-10 sm:py-10 text-center">
          {/* Title — Thin/Light font weight (300) */}
          <h1 className="font-mono text-2xl font-light uppercase tracking-[0.18em] text-glow text-[#F1F5F9] sm:text-4xl">
            ExhaustTrace
          </h1>

          {/* Subtitle */}
          <p className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.42em] text-[#00E5FF] sm:text-xs">
            Trace. Diagnose. Predict. Prevent.
          </p>

          {/* Description */}
          <p className="mx-auto mt-6 max-w-lg font-mono text-[0.75rem] leading-6 tracking-wide text-[#94A3B8]">
            Investigate resource exhaustion incidents in distributed systems.
            <br className="hidden sm:block" />
            Reconstruct causality. Identify root cause. Predict impact.
          </p>

          {/* Enter Investigation Button */}
          <button 
            type="button" 
            onClick={onEnter} 
            className="enter-btn mt-8 cursor-pointer"
          >
            &gt; Enter Investigation
          </button>

          {/* Scrolling Ticker */}
          <div className="ticker-wrap mt-8">
            <div className="ticker-track">
              <span className="ticker-text px-4">{TICKER_TEXT}</span>
              <span className="ticker-text px-4">{TICKER_TEXT}</span>
            </div>
          </div>
        </section>
      </main>

      {/* Bottom Spacer */}
      <div className="h-6 relative z-10" />
    </div>
  );
};
