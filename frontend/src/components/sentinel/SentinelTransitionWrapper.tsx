/**
 * SentinelTransitionWrapper
 * Pure frontend animated route transition into and out of Sentinel (/sentinel).
 * Departure beat (dim/desaturate) -> Soft light scanning beam sweep -> Arrival beat (reveal scale/fade).
 * Symmetrical exit, < 350ms duration, prefers-reduced-motion fallback.
 * Strictly scoped to Sentinel mode; zero impact on existing dashboard tabs.
 */

import React, { useEffect, useState } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import { useUI } from '../../lib/UIContext';
import { SentinelPage } from '../../pages/SentinelPage';
import { TopBar } from '../TopBar';
import { LeftNav } from '../LeftNav';
import { MainWorkspace } from '../MainWorkspace';
import { RightDrawer } from '../RightDrawer';
import { JudgeMode } from '../JudgeMode';

export const SentinelTransitionWrapper: React.FC = () => {
  const { isConnected } = useIncident();
  const { judgeMode, sentinelMode, setSentinelMode } = useUI();
  const [activeView, setActiveView] = useState<'sentinel' | 'dashboard'>(
    sentinelMode ? 'sentinel' : 'dashboard'
  );
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [animationClass, setAnimationClass] = useState<string>('');

  useEffect(() => {
    if (sentinelMode && activeView !== 'sentinel') {
      // Trigger Sentinel Entrance Sequence
      // 1. Departure beat (~180ms): outgoing view desaturates/dims
      setAnimationClass('sentinel-page-exit');
      setIsSweeping(true);

      const t1 = setTimeout(() => {
        // 2. View swap to Sentinel + Arrival beat (scaled 96% -> 100% reveal)
        setActiveView('sentinel');
        setAnimationClass('sentinel-page-enter');
      }, 180);

      const t2 = setTimeout(() => {
        setIsSweeping(false);
      }, 350);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else if (!sentinelMode && activeView === 'sentinel') {
      // Trigger Symmetrical Exit Sequence back to Dashboard
      setAnimationClass('sentinel-page-exit');
      setIsSweeping(true);

      const t1 = setTimeout(() => {
        setActiveView('dashboard');
        setAnimationClass('sentinel-page-enter');
      }, 180);

      const t2 = setTimeout(() => {
        setIsSweeping(false);
      }, 350);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [sentinelMode, activeView]);

  return (
    <>
      {/* Single pass soft light scanning beam overlay during transition */}
      {isSweeping && <div className="sentinel-sweep-beam" />}

      <div className={`w-full h-full ${animationClass}`}>
        {activeView === 'sentinel' ? (
          <SentinelPage onBackToDashboard={() => setSentinelMode(false)} />
        ) : judgeMode ? (
          <JudgeMode />
        ) : (
          <div className="flex flex-col h-screen overflow-hidden bg-background text-textMain relative">
            {!isConnected && (
              <div className="absolute inset-x-0 top-0 z-50 flex justify-center pt-4 pointer-events-none">
                <div className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-yellow-200 shadow-lg backdrop-blur-sm">
                  RECONNECTING...
                </div>
              </div>
            )}
            <TopBar />
            <div className="flex flex-1 overflow-hidden">
              <LeftNav />
              <MainWorkspace />
              <RightDrawer />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
