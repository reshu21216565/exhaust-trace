# ExhaustTrace

**ExhaustTrace** is a simulated distributed-system investigation platform. It observes a resource-exhaustion incident, reconstructs its causal propagation, identifies the original exhausted resource, makes a quantified prediction, and validates whether the prediction matches the resulting system behavior after intervention.

## Core Principles

1. **Deterministic Simulation:** The system state is powered by a deterministically seeded stochastic engine. 
2. **Strict Ground-Truth Isolation:** The simulation knows the actual injected root cause. The analyzer and Gemini **do not**. Ground truth is stripped at the observation boundary.
3. **Causal Reasoning:** The analyzer infers the root cause exclusively from observable telemetry, structured events, and the dependency graph.

## Package Boundaries

The monorepo enforces architectural isolation:

- **`@exhausttrace/simulation`**: Owns the authoritative state and physics engine. Contains hidden ground truth.
- **`@exhausttrace/observation`**: The isolation boundary. Transforms authoritative state into strictly observable telemetry and events.
- **`@exhausttrace/analysis`**: The inference engine. Consumes ONLY observable evidence and dependency graphs. Has no access to simulation internals.
- **`@exhausttrace/shared`**: Strongly typed contracts, graph definitions, and the `IncidentEvidenceBundle`.
- **`backend`**: Exposes the simulation and analyzer via API and WebSockets.
- **`frontend`**: The UI presentation layer.

## Graph Semantics

- **Dependency Graph:** `A -> B` means *A is the caller/dependent, and A depends on B.*
- **Causal Graph:** `A -> B` means *Observed condition/event A causally contributes to observed condition/event B.*

## Workflow

OBSERVE -> HYPOTHESIZE -> RECONSTRUCT -> PREDICT -> INTERVENE -> VERIFY
