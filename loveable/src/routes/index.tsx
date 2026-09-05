import { createFileRoute } from "@tanstack/react-router";
import { MatrixRain } from "@/components/MatrixRain";

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

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ExhaustTrace — Resource Exhaustion Investigation" },
      {
        name: "description",
        content:
          "Investigate resource exhaustion incidents in distributed systems. Reconstruct causality, identify root cause, predict impact.",
      },
      { property: "og:title", content: "ExhaustTrace — Resource Exhaustion Investigation" },
      {
        property: "og:description",
        content:
          "Trace. Diagnose. Predict. Prevent. Reconstruct causality across distributed systems.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      <MatrixRain />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-vignette" />

      <section className="glass-panel corner-frame relative z-10 w-full max-w-2xl px-6 py-10 text-center sm:px-12 sm:py-14">
        <span className="absolute left-6 top-4 font-mono text-[0.6rem] uppercase tracking-[0.35em] text-accent sm:left-10">
          // Mission Control
        </span>

        <h1 className="font-mono text-2xl font-light uppercase tracking-[0.18em] text-glow text-foreground sm:text-4xl">
          Exhaust<span className="font-semibold">Trace</span>
        </h1>

        <p className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.42em] text-accent sm:text-xs">
          Trace. Diagnose. Predict. Prevent.
        </p>

        <p className="mx-auto mt-6 max-w-lg font-mono text-[0.75rem] leading-6 tracking-wide text-muted-foreground">
          Investigate resource exhaustion incidents in distributed systems.
          <br className="hidden sm:block" />
          Reconstruct causality. Identify root cause. Predict impact.
        </p>

        <button type="button" className="enter-btn mt-8">
          &gt; Enter Investigation
        </button>

        <div className="ticker-wrap mt-8">
          <div className="ticker-track">
            <span className="ticker-text px-4">{TICKER_TEXT}</span>
            <span className="ticker-text px-4">{TICKER_TEXT}</span>
          </div>
        </div>
      </section>
    </main>
  );
}
