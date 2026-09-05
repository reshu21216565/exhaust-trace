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
        sans: ['Inter', 'system-ui', 'sans-serif'],
        space: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: '#0a0a0a',
        brandBg: '#080D13',
        surface: '#171717',
        surfaceHover: '#262626',
        border: '#404040',
        primary: '#4F46E5', // Indigo
        primaryHover: '#4338CA',
        
        cyanAccent: '#00E5FF',
        cyanSoft: '#00D8D6',

        // Semantic Colors
        healthy: '#10B981',    // Green
        elevated: '#F59E0B',   // Amber
        degraded: '#F97316',   // Orange
        critical: '#EF4444',   // Red
        info: '#3B82F6',       // Blue

        textMain: '#F9FAFB',
        textMuted: '#A1A1AA',
      },
    },
  },
  plugins: [],
}
