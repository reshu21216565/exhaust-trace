import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import type {
  IncidentEvidenceBundle,
  IncidentSessionStatus,
  GroundTruthReveal,
} from '@exhausttrace/shared';

interface IncidentContextState {
  isConnected: boolean;
  bundle: IncidentEvidenceBundle | null;
  groundTruth: GroundTruthReveal | null;
  startIncident: (scenarioId?: string, seed?: string) => Promise<void>;
  startCustomIncident: (serviceId: string, resource: string, severity: string, seed?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  step: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  reset: () => Promise<void>;
  lockPrediction: () => Promise<void>;
  runRootExperiment: () => Promise<void>;
  runSymptomExperiment: (serviceId: string, resource: string) => Promise<void>;
  revealGroundTruth: () => Promise<void>;
  completeIncident: () => Promise<void>;
}

const IncidentContext = createContext<IncidentContextState | null>(null);

const API_URL = 'http://localhost:3001/api/v1';
const SOCKET_URL = 'http://localhost:3001';

export const IncidentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [bundle, setBundle] = useState<IncidentEvidenceBundle | null>(null);
  const [groundTruth, setGroundTruth] = useState<GroundTruthReveal | null>(null);

  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        const res = await fetch(`${API_URL}/incident/state`);
        if (res.ok) {
          const data: IncidentEvidenceBundle = await res.json();
          setBundle(data);
        }
      } catch (err) {
        console.error("Failed to fetch initial state:", err);
      }
    };
    
    fetchInitialState();

    const newSocket = io(SOCKET_URL);

    newSocket.on('connect', () => setIsConnected(true));
    newSocket.on('connect_error', () => setIsConnected(false));
    newSocket.on('disconnect', () => setIsConnected(false));

    newSocket.on('incident:state', (wrapper: any) => {
      setBundle(wrapper.payload || wrapper);
    });

    newSocket.on('telemetry:tick', (wrapper: any) => {
      const tick = wrapper.payload || wrapper;
      setBundle(prev => {
        if (!prev) return prev;
        const history = [...prev.telemetryHistory, tick];
        if (history.length > 100) history.shift();
        return {
          ...prev,
          currentTelemetry: tick,
          telemetryHistory: history,
          playback: { ...prev.playback, tick: tick.tick, timestamp: tick.timestamp }
        };
      });
    });

    newSocket.on('incident:event', (wrapper: any) => {
      const event = wrapper.payload || wrapper;
      setBundle(prev => {
        if (!prev) return prev;
        const events = [...prev.events, event];
        if (events.length > 500) events.shift();
        return { ...prev, events };
      });
    });

    newSocket.on('analysis:updated', (wrapper: any) => {
      const analysis = wrapper.payload || wrapper;
      setBundle(prev => prev ? { ...prev, causalAnalysis: analysis } : prev);
    });

    newSocket.on('prediction:available', (wrapper: any) => {
      const pred = wrapper.payload || wrapper;
      setBundle(prev => prev ? { ...prev, prediction: pred } : prev);
    });

    newSocket.on('prediction:locked', (wrapper: any) => {
      const pred = wrapper.payload || wrapper;
      setBundle(prev => prev ? { ...prev, status: 'PREDICTION_LOCKED' as IncidentSessionStatus, prediction: pred } : prev);
    });

    newSocket.on('experiment:started', () => {
      setBundle(prev => prev ? { ...prev, status: 'EXPERIMENT_RUNNING' as IncidentSessionStatus } : prev);
    });

    newSocket.on('experiment:completed', (wrapper: any) => {
      const { type, trajectory } = wrapper.payload || wrapper;
      setBundle(prev => {
        if (!prev) return prev;
        const updated = { ...prev };
        if (type === 'ROOT') updated.rootTrajectory = trajectory;
        if (type === 'SYMPTOM') updated.symptomTrajectory = trajectory;
        return updated;
      });
    });

    newSocket.on('validation:updated', (wrapper: any) => {
      const { type, validation } = wrapper.payload || wrapper;
      setBundle(prev => {
        if (!prev) return prev;
        const updated = { ...prev, status: 'VALIDATED' as IncidentSessionStatus };
        if (type === 'ROOT') updated.rootValidation = validation;
        if (type === 'SYMPTOM') updated.symptomValidation = validation;
        return updated;
      });
    });

    newSocket.on('incident:completed', () => {
      setBundle(prev => prev ? { ...prev, status: 'COMPLETED' as IncidentSessionStatus } : prev);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const action = useCallback(async (path: string, body?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.json();
      console.error(`API Error on ${path}:`, err);
      throw err;
    }
    return res.json();
  }, []);

  const startIncident = useCallback(async (scenarioId = 'default_exhaustion', seed?: string) => {
    const data = await action('/incident/start', { scenarioId, seed });
    setBundle(data);
    setGroundTruth(null);
  }, [action]);

  const startCustomIncident = useCallback(async (serviceId: string, resource: string, severity: string, seed?: string) => {
    const data = await action('/incident/start-custom', { serviceId, resource, severity, seed });
    setBundle(data);
    setGroundTruth(null);
  }, [action]);

  const pause = useCallback(() => action('/incident/pause'), [action]);
  const resume = useCallback(() => action('/incident/resume'), [action]);
  const step = useCallback(() => action('/incident/step'), [action]);
  const setSpeed = useCallback((speed: number) => action('/incident/speed', { speed }), [action]);
  const reset = useCallback(async () => {
    const data = await action('/incident/reset');
    setBundle(data);
    setGroundTruth(null);
  }, [action]);
  const refreshState = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/incident/state`);
      if (res.ok) {
        const data: IncidentEvidenceBundle = await res.json();
        setBundle(data);
      }
    } catch (err) {
      console.error("Failed to refresh state:", err);
    }
  }, []);

  const lockPrediction = useCallback(async () => {
    await action('/incident/prediction/lock');
    await refreshState();
  }, [action, refreshState]);

  const runRootExperiment = useCallback(async () => {
    await action('/incident/experiment/root');
    await refreshState();
  }, [action, refreshState]);

  const runSymptomExperiment = useCallback(async (serviceId: string, resource: string) => {
    await action('/incident/experiment/symptom', { serviceId, resource });
    await refreshState();
  }, [action, refreshState]);
  
  const revealGroundTruth = useCallback(async () => {
    const truth = await action('/incident/reveal');
    setGroundTruth(truth);
  }, [action]);
  
  const completeIncident = useCallback(async () => {
    await action('/incident/complete');
    await refreshState();
  }, [action, refreshState]);

  return (
    <IncidentContext.Provider value={{
      isConnected,
      bundle,
      groundTruth,
      startIncident,
      startCustomIncident,
      pause,
      resume,
      step,
      setSpeed,
      reset,
      lockPrediction,
      runRootExperiment,
      runSymptomExperiment,
      revealGroundTruth,
      completeIncident
    }}>
      {children}
    </IncidentContext.Provider>
  );
};

export const useIncident = () => {
  const ctx = useContext(IncidentContext);
  if (!ctx) throw new Error("useIncident must be used within an IncidentProvider");
  return ctx;
};
