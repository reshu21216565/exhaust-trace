/**
 * AnalystVoiceTab — Redirects to the real AnalystPanel (Gemini-backed Q&A).
 * The "voice" shell has been replaced with actual evidence-grounded investigation.
 */
import React from 'react';
import { AnalystPanel } from '../judge/AnalystPanel';

export const AnalystVoiceTab: React.FC = () => {
  return <AnalystPanel compact={false} />;
};
