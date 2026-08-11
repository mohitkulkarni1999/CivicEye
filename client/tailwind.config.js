/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dce7fd',
          200: '#c0d3fb',
          300: '#94b5f8',
          400: '#6190f3',
          500: '#3d6cee',
          600: '#2c4ee3',
          700: '#253bd1',
          800: '#2331aa',
          900: '#222f86',
        },
        ink: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          500: '#64748b',
          400: '#94a3b8',
          300: '#cbd5e1',
          200: '#e2e8f0',
          100: '#f1f5f9',
          50: '#f8fafc',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.06)',
        lift: '0 12px 40px rgba(15,23,42,.14)',
      },
    },
  },
  plugins: [],
};
