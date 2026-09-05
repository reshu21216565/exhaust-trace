import React, { createContext, useContext, useState } from 'react';

export type ViewTab = 'Overview' | 'Causal Analysis' | 'Evidence' | 'Prediction' | 'Experiment' | 'Validation' | 'Timeline' | 'Report' | 'Confidence' | 'Benchmark' | 'Concurrent' | 'Analyst Voice';

interface UIContextState {
  activeTab: ViewTab;
  setActiveTab: (tab: ViewTab) => void;
  selectedCandidateId: string | null;
  setSelectedCandidateId: (id: string | null) => void;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  judgeMode: boolean;
  setJudgeMode: (enabled: boolean) => void;
}

const UIContext = createContext<UIContextState | null>(null);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<ViewTab>('Overview');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [judgeMode, setJudgeMode] = useState<boolean>(false);

  return (
    <UIContext.Provider value={{
      activeTab,
      setActiveTab,
      selectedCandidateId,
      setSelectedCandidateId,
      selectedNodeId,
      setSelectedNodeId,
      judgeMode,
      setJudgeMode
    }}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
};
