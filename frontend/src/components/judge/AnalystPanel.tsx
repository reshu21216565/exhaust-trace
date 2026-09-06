/**
 * AnalystPanel — ExhaustTrace Analyst powered by Gemini.
 * Evidence-grounded Q&A using the actual IncidentEvidenceBundle.
 * Used in both JudgeMode and the AnalystVoiceTab.
 * No API key exposure — all requests go through backend /api/v1/ai/analyze.
 * Full Voice Support: Speech Synthesis (Analyst Talking) & Speech Recognition (Talking to Analyst).
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import {
  Bot, Send, Wifi, WifiOff, Sparkles, MessageSquare,
  ChevronRight, Loader2, RefreshCw, Volume2, VolumeX,
  Mic, MicOff, Play, Square, Settings
} from 'lucide-react';
import { clsx } from 'clsx';

const API_BASE = 'http://localhost:3001/api/v1';

interface Message {
  id: string;
  role: 'user' | 'analyst';
  text: string;
  geminiAvailable?: boolean;
  timestamp: number;
}

const SUGGESTED_QUESTIONS = [
  'Why is the top hypothesis ranked first?',
  'Why not the second candidate?',
  'Explain the propagation chain.',
  'What evidence changed the confidence?',
  'What did the prediction expect?',
  'Did the experiment validate the hypothesis?',
  'What is happening right now?',
  'Which service is most affected?',
];

interface AnalystPanelProps {
  compact?: boolean;
}

export const AnalystPanel: React.FC<AnalystPanelProps> = ({ compact = false }) => {
  const { bundle } = useIncident();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  
  // Voice Synthesis (Analyst Output) State
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const voiceEnabledRef = useRef(true);

  // Voice Recognition (Speech Input) State
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load available speech synthesis voices
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (voices.length > 0 && !selectedVoiceURI) {
        // Default to a good English voice if available
        const defaultVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel'))) || voices.find(v => v.lang.startsWith('en')) || voices[0];
        if (defaultVoice) {
          setSelectedVoiceURI(defaultVoice.voiceURI);
        }
      }
    };

    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, [selectedVoiceURI]);

  // Handle Voice Toggle
  const toggleVoice = () => {
    const next = !isVoiceEnabled;
    setIsVoiceEnabled(next);
    voiceEnabledRef.current = next;
    if (!next && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingMsgId(null);
    }
  };

  // Speak specific text on demand
  const speakText = useCallback((text: string, msgId?: string) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();

    if (msgId && speakingMsgId === msgId && isSpeaking) {
      setIsSpeaking(false);
      setSpeakingMsgId(null);
      return;
    }

    const cleanText = text.replace(/[*_#`]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;

    if (selectedVoiceURI) {
      const voice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      if (msgId) setSpeakingMsgId(msgId);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingMsgId(null);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingMsgId(null);
    };

    window.speechSynthesis.speak(utterance);
  }, [speakingMsgId, isSpeaking, selectedVoiceURI, availableVoices]);

  // Stop current speech playback
  const stopSpeaking = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setSpeakingMsgId(null);
  };

  // Handle Microphone / Voice Recognition Input
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech Recognition API is not supported in this browser. Please type your message.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInputText(transcript);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      setIsListening(false);
    }
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Read aloud new analyst messages automatically if voice is enabled
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'analyst' && voiceEnabledRef.current) {
      speakText(lastMsg.text, lastMsg.id);
    }
  }, [messages, speakText]);

  const sendQuestion = async (question: string) => {
    const q = question.trim();
    if (!q || isLoading) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: q,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Server error' }));
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`,
          role: 'analyst',
          text: `ExhaustTrace Analyst is unavailable: ${err.message}`,
          geminiAvailable: false,
          timestamp: Date.now(),
        }]);
        setGeminiStatus('unavailable');
        return;
      }

      const data = await res.json();
      setGeminiStatus(data.geminiAvailable ? 'available' : 'unavailable');
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'analyst',
        text: data.answer,
        geminiAvailable: data.geminiAvailable,
        timestamp: Date.now(),
      }]);
    } catch (err: any) {
      setGeminiStatus('unavailable');
      setMessages(prev => [...prev, {
        id: `a-err-${Date.now()}`,
        role: 'analyst',
        text: 'ExhaustTrace Analyst is currently unavailable. Core causal investigation remains fully operational.',
        geminiAvailable: false,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (compact) {
    // Compact mode for Judge Mode sidebar
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest">EXHAUSTTRACE ANALYST</span>
          </div>
          <div className="flex items-center gap-2">
            {isSpeaking && (
              <button
                onClick={stopSpeaking}
                title="Stop Voice Output"
                className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-mono flex items-center gap-1 animate-pulse"
              >
                <Square className="w-2.5 h-2.5 fill-primary" /> STOP
              </button>
            )}
            <button
              onClick={toggleVoice}
              title={isVoiceEnabled ? 'Voice Enabled (Click to Mute)' : 'Voice Disabled (Click to Enable)'}
              className={clsx('p-1 rounded transition-colors', isVoiceEnabled ? 'text-primary bg-primary/10' : 'text-textMuted hover:text-textMain hover:bg-surfaceHover')}
            >
              {isVoiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <span className={clsx('flex items-center gap-1 text-[10px] font-mono font-bold', {
              'text-textMuted': geminiStatus === 'unknown',
              'text-healthy': geminiStatus === 'available',
              'text-elevated': geminiStatus === 'unavailable',
            })}>
              {geminiStatus === 'available' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {geminiStatus === 'available' ? 'GEMINI' : geminiStatus === 'unavailable' ? 'FALLBACK' : 'READY'}
            </span>
          </div>
        </div>

        {/* Message list (compact) */}
        {messages.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {messages.slice(-4).map(msg => (
              <div key={msg.id} className={clsx('text-xs font-mono rounded p-2 relative group', {
                'bg-surface/40 text-textMuted border border-border/50 text-right': msg.role === 'user',
                'bg-primary/5 text-textMain border border-primary/10': msg.role === 'analyst',
              })}>
                {msg.role === 'analyst' && (
                  <div className="flex items-center justify-between text-[9px] text-primary font-bold mb-1">
                    <div className="flex items-center gap-1">
                      <Bot className="w-2.5 h-2.5" />
                      {msg.geminiAvailable ? 'GEMINI ANALYST' : 'EVIDENCE ENGINE'}
                    </div>
                    <button
                      onClick={() => speakText(msg.text, msg.id)}
                      title="Speak response"
                      className="text-textMuted hover:text-primary transition-colors p-0.5"
                    >
                      {speakingMsgId === msg.id && isSpeaking ? (
                        <Square className="w-2.5 h-2.5 text-primary fill-primary animate-pulse" />
                      ) : (
                        <Play className="w-2.5 h-2.5" />
                      )}
                    </button>
                  </div>
                )}
                <p className="leading-relaxed">{msg.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* Quick chips */}
        <div className="flex flex-wrap gap-1">
          {SUGGESTED_QUESTIONS.slice(0, 3).map(q => (
            <button
              key={q}
              onClick={() => sendQuestion(q)}
              disabled={isLoading}
              className="px-2 py-0.5 text-[9px] font-mono bg-surface border border-border hover:border-primary/40 text-textMuted hover:text-primary rounded transition-colors"
            >
              {q.slice(0, 30)}…
            </button>
          ))}
        </div>

        {/* Input with Voice Input (Microphone) */}
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendQuestion(inputText)}
            placeholder={isListening ? 'Listening...' : 'Ask about the investigation...'}
            className={clsx(
              'flex-1 bg-background border rounded px-2.5 py-1.5 text-xs text-textMain placeholder:text-textMuted focus:outline-none font-mono transition-colors',
              isListening ? 'border-primary bg-primary/5 text-primary' : 'border-border focus:border-primary'
            )}
          />
          <button
            onClick={toggleListening}
            title={isListening ? 'Stop Listening' : 'Speak to Analyst (Mic)'}
            className={clsx(
              'p-1.5 border rounded transition-colors',
              isListening ? 'bg-primary text-white border-primary animate-pulse' : 'bg-surface border-border text-textMuted hover:text-textMain'
            )}
          >
            {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => sendQuestion(inputText)}
            disabled={isLoading || !inputText.trim()}
            className="p-1.5 bg-primary hover:bg-primaryHover disabled:opacity-40 text-white rounded transition-colors"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  // Full-size mode for AnalystVoiceTab
  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 flex items-center gap-1.5 uppercase">
              <Bot className="w-3.5 h-3.5" /> EXHAUSTTRACE ANALYST VOICE
            </span>
            <span className={clsx('px-2.5 py-1 rounded text-xs font-mono font-bold uppercase flex items-center gap-1.5', {
              'bg-surface text-textMuted border border-border': geminiStatus === 'unknown',
              'bg-healthy/10 text-healthy border border-healthy/20': geminiStatus === 'available',
              'bg-elevated/10 text-elevated border border-elevated/20': geminiStatus === 'unavailable',
            })}>
              {geminiStatus === 'available' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {geminiStatus === 'available' ? 'GEMINI CONNECTED' : geminiStatus === 'unavailable' ? 'AI UNAVAILABLE — EVIDENCE ENGINE ACTIVE' : 'CONNECTED'}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-textMain tracking-tight">ExhaustTrace Voice Analyst</h1>
          <p className="text-xs text-textMuted font-mono mt-1">Talk to Gemini or listen to incident findings in real-time — grounded in true telemetry evidence</p>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {/* Active Speaking Indicator */}
          {isSpeaking && (
            <button
              onClick={stopSpeaking}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-xs font-mono transition-colors shadow animate-pulse"
            >
              <Square className="w-3.5 h-3.5 fill-white" /> Stop Analyst Voice
            </button>
          )}

          {/* Voice Toggle */}
          <button
            onClick={toggleVoice}
            className={clsx('flex items-center gap-1.5 px-3 py-2 border rounded-lg text-xs font-mono transition-colors', 
              isVoiceEnabled ? 'text-primary bg-primary/10 border-primary/30' : 'text-textMuted hover:text-textMain border-border hover:bg-surfaceHover'
            )}
          >
            {isVoiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            {isVoiceEnabled ? 'Voice Enabled' : 'Voice Muted'}
          </button>

          {/* Settings Button (Voice Selector) */}
          {availableVoices.length > 0 && (
            <button
              onClick={() => setShowVoiceSettings(prev => !prev)}
              title="Voice Settings"
              className={clsx('p-2 border rounded-lg transition-colors', showVoiceSettings ? 'text-primary bg-primary/10 border-primary/30' : 'text-textMuted border-border hover:bg-surfaceHover')}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}

          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); stopSpeaking(); }}
              className="flex items-center gap-1.5 px-3 py-2 border border-border text-textMuted hover:text-textMain hover:bg-surfaceHover rounded-lg text-xs font-mono transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Voice Selection Panel Dropdown */}
      {showVoiceSettings && availableVoices.length > 0 && (
        <div className="glass-panel p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border border-primary/20 bg-primary/5">
          <div className="flex items-center gap-2 text-xs font-mono text-textMain">
            <Volume2 className="w-4 h-4 text-primary" />
            <span>Select Analyst TTS Voice Engine:</span>
          </div>
          <select
            value={selectedVoiceURI}
            onChange={e => setSelectedVoiceURI(e.target.value)}
            className="bg-background border border-border text-textMain text-xs font-mono rounded px-3 py-1.5 focus:outline-none focus:border-primary max-w-full md:max-w-md"
          >
            {availableVoices.map(v => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Security & Voice Info Notice */}
      <div className="px-4 py-3 bg-surface border border-border/50 rounded-lg text-[10px] font-mono text-textMuted flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          <strong>Voice Option Active:</strong> Click the microphone icon to speak to the analyst, or press the play button on any response to hear the analyst explain the findings aloud.
        </span>
      </div>

      {/* Suggested Questions */}
      <div className="glass-panel p-5">
        <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-primary" />
          Suggested Voice Questions
        </h3>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => sendQuestion(q)}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-surface border border-border hover:border-primary/40 hover:bg-surfaceHover text-textMuted hover:text-textMain rounded-lg transition-colors"
            >
              <ChevronRight className="w-3 h-3 text-primary" />
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Message Thread */}
      <div className="glass-panel p-5">
        <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-4 pb-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-primary" />
            Voice Investigation Thread
          </div>
          {isSpeaking && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-primary animate-pulse">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Analyst is speaking...</span>
            </div>
          )}
        </h3>

        {messages.length === 0 && !isLoading ? (
          <div className="py-12 text-center text-textMuted">
            <Bot className="w-12 h-12 mx-auto mb-3 text-primary/40 animate-pulse" />
            <p className="text-sm font-medium text-textMain">ExhaustTrace Analyst Voice Assistant</p>
            <p className="text-xs mt-1 text-textMuted">Click the microphone below to speak your question or select a suggested topic.</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            {messages.map(msg => (
              <div key={msg.id} className={clsx('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'analyst' && (
                  <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div className={clsx('max-w-[85%] rounded-xl px-4 py-3 text-sm relative group', {
                  'bg-primary/10 text-textMain border border-primary/10': msg.role === 'user',
                  'bg-surface border border-border text-textMain': msg.role === 'analyst',
                  'border-primary shadow-sm shadow-primary/20': msg.role === 'analyst' && speakingMsgId === msg.id && isSpeaking,
                })}>
                  {msg.role === 'analyst' && (
                    <div className="flex items-center justify-between text-[10px] font-mono font-bold mb-1.5 border-b border-border/40 pb-1">
                      <span className={clsx('flex items-center gap-1.5', msg.geminiAvailable ? 'text-primary' : 'text-textMuted')}>
                        {msg.geminiAvailable ? (
                          <><Wifi className="w-2.5 h-2.5" /> GEMINI VOICE ANALYST</>
                        ) : (
                          <><Sparkles className="w-2.5 h-2.5" /> EVIDENCE ENGINE</>
                        )}
                      </span>
                      
                      <button
                        onClick={() => speakText(msg.text, msg.id)}
                        className={clsx(
                          'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors',
                          speakingMsgId === msg.id && isSpeaking
                            ? 'bg-primary text-white animate-pulse'
                            : 'bg-surfaceHover text-textMuted hover:text-primary hover:bg-primary/10'
                        )}
                        title="Listen to Analyst Voice"
                      >
                        {speakingMsgId === msg.id && isSpeaking ? (
                          <><Square className="w-2.5 h-2.5 fill-white" /> Speaking...</>
                        ) : (
                          <><Play className="w-2.5 h-2.5 fill-current" /> Read Aloud</>
                        )}
                      </button>
                    </div>
                  )}
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  <div className="text-[10px] text-textMuted mt-1.5 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-surface border border-border rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-textMuted font-mono">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    Consulting Gemini Causal Analyst...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Section with Voice (Mic) Option */}
      <div className="glass-panel p-4">
        <div className="flex gap-3 items-center">
          <button
            onClick={toggleListening}
            title={isListening ? 'Stop Listening' : 'Speak Question (Mic)'}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all shadow border',
              isListening
                ? 'bg-red-500 hover:bg-red-600 text-white border-red-400 animate-pulse'
                : 'bg-surface hover:bg-surfaceHover text-textMain border-border hover:border-primary/40'
            )}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-primary" />}
            <span className="font-mono text-xs hidden sm:inline">
              {isListening ? 'Listening...' : 'Voice Input'}
            </span>
          </button>

          <input
            ref={inputRef}
            type="text"
            id="analyst-question-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendQuestion(inputText)}
            placeholder={isListening ? 'Listening to your voice...' : 'Ask or speak a question to the Analyst...'}
            className={clsx(
              'flex-1 bg-background border rounded-lg px-4 py-2.5 text-sm text-textMain placeholder:text-textMuted focus:outline-none font-mono transition-colors',
              isListening ? 'border-primary bg-primary/5 text-primary' : 'border-border focus:border-primary'
            )}
          />

          <button
            id="analyst-send-btn text-white"
            onClick={() => sendQuestion(inputText)}
            disabled={isLoading || !inputText.trim()}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-primary hover:bg-primaryHover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors shadow"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">ASK</span>
          </button>
        </div>

        {isListening && (
          <p className="text-xs text-primary font-mono mt-2 flex items-center gap-2 animate-pulse">
            <Mic className="w-3.5 h-3.5" /> Speak clearly into your microphone now...
          </p>
        )}

        {geminiStatus === 'unavailable' && (
          <p className="text-[10px] text-elevated font-mono mt-2 flex items-center gap-1">
            <WifiOff className="w-3 h-3" />
            Gemini AI is currently unavailable. Answers are generated from the evidence engine using actual incident data.
          </p>
        )}
      </div>
    </div>
  );
};

