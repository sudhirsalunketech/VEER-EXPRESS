/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#eef2f9', 100: '#d6deee', 200: '#aebddc', 400: '#5470a8', 600: '#1f3a75', 700: '#162d5e', 800: '#0f2149', 900: '#0a1733' },
        brand: { 50: '#fff4ec', 100: '#ffe3cf', 400: '#ff8a3d', 500: '#f26a12', 600: '#d95a08', 700: '#b34806' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(10,23,51,.06), 0 4px 16px rgba(10,23,51,.06)' },
      keyframes: { rise: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'none' } } },
      animation: { rise: 'rise .5s ease-out both' },
    },
  },
  plugins: [],
};
