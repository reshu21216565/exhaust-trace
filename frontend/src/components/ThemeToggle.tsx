import React, { useState } from 'react';
import { Sun } from 'lucide-react';

export const ThemeToggle: React.FC = () => {
  const [isLight, setIsLight] = useState<boolean>(false);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono tracking-[0.22em] text-[#94A3B8] uppercase select-none">
        LIGHT MODE
      </span>
      <button
        onClick={() => setIsLight(!isLight)}
        className="w-[60px] h-[30px] rounded-full bg-[#0B111B] border border-[#00E5FF]/30 p-[3px] flex items-center transition-colors relative focus:outline-none focus:ring-1 focus:ring-[#00E5FF]"
        title="Toggle Theme"
        aria-label="Toggle Light Mode"
      >
        <div
          className={`w-[22px] h-[22px] rounded-full bg-[#00E5FF] flex items-center justify-center transition-transform duration-300 shadow-[0_0_10px_rgba(0,229,255,0.8)] ${
            isLight ? 'translate-x-[30px]' : 'translate-x-0'
          }`}
        >
          <Sun className="w-3.5 h-3.5 text-[#080D13]" />
        </div>
      </button>
    </div>
  );
};
