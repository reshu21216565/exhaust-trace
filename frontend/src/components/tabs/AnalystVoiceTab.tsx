import React, { useState, useEffect } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import { Volume2, VolumeX, Play, Pause, Square, Sparkles, MessageSquare, Bot, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';

export const AnalystVoiceTab: React.FC = () => {
  const { bundle } = useIncident();
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [transcriptText, setTranscriptText] = useState<string>('');
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);

  const topCandidate = bundle?.causalAnalysis?.topCandidate;
  const confidencePercent = topCandidate ? Math.round(topCandidate.confidence * 100) : 0;
  const tickCount = bundle?.playback.tick ?? 0;

  const defaultSampleText = topCandidate
    ? `ExhaustTrace Analyst Report. The incident simulation is currently at tick ${tickCount}. Causal analysis has identified the root cause with ${confidencePercent} percent confidence as ${topCandidate.serviceId} under severe ${topCandidate.resource} exhaustion. Cascade propagation evidence indicates downstream timeouts and queue buildup originating from ${topCandidate.serviceId}.`
    : `ExhaustTrace Analyst Report. Telemetry observation is active. Awaiting additional resource pressure metrics to reach statistical threshold for causal root cause identification.`;

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeechSupported(false);
    }
  }, []);

  const handleSpeak = (textToSpeak: string) => {
    if (!('speechSynthesis' in window)) {
      setSpeechSupported(false);
      setTranscriptText(textToSpeak);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = speechRate;
    utterance.volume = isMuted ? 0 : 1;

    utterance.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
    };

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };

    setTranscriptText(textToSpeak);
    window.speechSynthesis.speak(utterance);
  };

  const handlePause = () => {
    if (window.speechSynthesis) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPaused(false);
      } else {
        window.speechSynthesis.pause();
        setIsPaused(true);
      }
    }
  };

  const handleStop = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      setIsPaused(false);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (window.speechSynthesis && isPlaying) {
      handleSpeak(transcriptText || defaultSampleText);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Top Header Card */}
      <div className="glass-panel p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase flex items-center gap-1">
              <Bot className="w-3.5 h-3.5" /> AI ANALYST SPEECH SYNTHESIS
            </span>
            <span className={clsx(
              "px-2.5 py-1 rounded text-xs font-mono font-bold uppercase",
              speechSupported ? "bg-healthy/10 text-healthy border border-healthy/20" : "bg-elevated/10 text-elevated border border-elevated/20"
            )}>
              {speechSupported ? 'AUDIO ENGINE READY' : 'SPEECH API UNSUPPORTED (FALLBACK ACTIVE)'}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-textMain tracking-tight">AI Analyst Voice Narration</h1>
          <p className="text-xs text-textMuted font-mono mt-1">Hands-free auditory narration of root cause diagnostics via Web Speech API</p>
        </div>

        <button
          onClick={() => handleSpeak(defaultSampleText)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primaryHover text-white rounded-lg font-medium text-sm transition-colors shadow-lg shrink-0"
        >
          <Volume2 className="w-4 h-4" />
          NARRATE LATEST ANALYST RESPONSE
        </button>
      </div>

      {/* Audio Controls Bar */}
      <div className="glass-panel p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSpeak(transcriptText || defaultSampleText)}
            className="p-2.5 bg-primary hover:bg-primaryHover text-white rounded-lg transition-colors shadow"
            title="Play / Restart"
          >
            <Play className="w-4 h-4 fill-white" />
          </button>
          <button
            onClick={handlePause}
            disabled={!isPlaying}
            className="p-2.5 bg-surfaceHover hover:bg-surface text-textMain disabled:opacity-40 rounded-lg border border-border transition-colors"
            title="Pause / Resume"
          >
            <Pause className="w-4 h-4" />
          </button>
          <button
            onClick={handleStop}
            disabled={!isPlaying}
            className="p-2.5 bg-surfaceHover hover:bg-surface text-critical disabled:opacity-40 rounded-lg border border-border transition-colors"
            title="Stop"
          >
            <Square className="w-4 h-4 fill-critical" />
          </button>
          <button
            onClick={toggleMute}
            className="p-2.5 bg-surfaceHover hover:bg-surface text-textMain rounded-lg border border-border transition-colors ml-2"
            title="Mute / Unmute"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-critical" /> : <Volume2 className="w-4 h-4 text-healthy" />}
          </button>
        </div>

        {/* Speed Controls */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-textMuted uppercase">Speech Speed:</span>
          {[0.8, 1.0, 1.2, 1.5].map((rate) => (
            <button
              key={rate}
              onClick={() => { setSpeechRate(rate); if (isPlaying) handleSpeak(transcriptText || defaultSampleText); }}
              className={clsx(
                "px-2.5 py-1 text-xs font-mono rounded border transition-colors",
                speechRate === rate ? "bg-primary text-white border-primary" : "bg-surface text-textMuted border-border hover:bg-surfaceHover"
              )}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Status Indicator */}
        <div className="flex items-center justify-end gap-2 text-xs font-mono">
          <span className={clsx("w-2.5 h-2.5 rounded-full animate-pulse", isPlaying ? "bg-healthy" : "bg-textMuted")} />
          <span className="text-textMuted">
            {isPlaying ? (isPaused ? "AUDIO PAUSED" : "NARRATING ALOUD...") : "IDLE"}
          </span>
        </div>
      </div>

      {/* Visible Transcript Card */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <h3 className="font-semibold text-textMain text-sm uppercase tracking-wider flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Live Analyst Speech Transcript
          </h3>
          <span className="text-xs font-mono text-textMuted">Web Speech API</span>
        </div>

        {!transcriptText ? (
          <div className="p-8 text-center flex flex-col items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary mb-3" />
            <p className="text-sm text-textMuted mb-4">
              Click <strong>"NARRATE LATEST ANALYST RESPONSE"</strong> above to listen to live AI audio narration.
            </p>
          </div>
        ) : (
          <div className="p-5 bg-surface/60 border border-border rounded-xl font-mono text-sm text-textMain leading-relaxed relative">
            <div className="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 uppercase font-bold">
              Active Audio Output
            </div>
            {transcriptText}
          </div>
        )}
      </div>
    </div>
  );
};
