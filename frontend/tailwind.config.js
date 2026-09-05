/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        space: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: '#0A0E14',
        brandBg: '#080D13',
        surface: 'rgba(11, 17, 27, 0.65)',
        surfaceHover: 'rgba(18, 27, 42, 0.85)',
        border: 'rgba(0, 229, 255, 0.22)',
        borderMuted: 'rgba(100, 220, 255, 0.12)',
        primary: '#00E5FF',
        primaryHover: '#00C8E5',
        accent: '#00E5FF',
        
        cyanAccent: '#00E5FF',
        cyanSoft: '#00D8D6',

        // Preserved Semantic Status Colors
        healthy: '#10B981',    // Green
        elevated: '#F59E0B',   // Amber
        degraded: '#F97316',   // Orange
        critical: '#EF4444',   // Red
        info: '#3B82F6',       // Blue

        textMain: '#F1F5F9',
        textMuted: '#94A3B8',
      },
    },
  },
  plugins: [],
}
