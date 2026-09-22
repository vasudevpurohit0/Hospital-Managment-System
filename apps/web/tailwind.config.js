/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // AAYUSH SAARTHI navy — the dominant structural colour
        primary: {
          50: '#F1F6FA',
          100: '#DEEAF3',
          200: '#BCD2E5',
          300: '#8FB0CE',
          400: '#4A7BA6',
          500: '#062B4F',
          600: '#052340',
          700: '#031C33',
          800: '#021325',
          900: '#010C18',
        },
        // AAYUSH SAARTHI orange — actions, active states, highlights only
        accent: {
          50: '#FFF1E3',
          100: '#FFE1C6',
          200: '#FFC895',
          300: '#FDA85C',
          400: '#FB9230',
          500: '#F97D09',
          600: '#E06E05',
          700: '#B85903',
          800: '#8F4502',
          900: '#6B3401',
        },
        secondary: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#0D9488',
          600: '#0F766E',
          700: '#115E59',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          secondary: 'var(--color-surface-secondary)',
          tertiary: 'var(--color-surface-tertiary)',
          hover: 'var(--color-surface-hover)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
        },
        success: {
          50: '#ECFAF1',
          100: '#D1F0DE',
          500: '#1E8A4F',
          600: '#17703F',
          700: '#115631',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          500: '#D97706',
          600: '#B45309',
        },
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#DC2626',
          600: '#B91C1C',
        },
        // Legacy alias for existing Tailwind classes
        'esic-primary': '#062B4F',
        'esic-primary-dark': '#031C33',
        'esic-secondary': '#0D9488',
        'esic-accent': '#F97D09',
        // Canonical AAYUSH SAARTHI brand values from the approved design
        'saarthi-navy': '#062B4F',
        'saarthi-navy-dark': '#031C33',
        'saarthi-orange': '#F97D09',
        'saarthi-orange-light': '#FFF1E3',
        'saarthi-canvas': '#F8F7F3',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Devanagari', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        devanagari: ['Noto Sans Devanagari', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      fontSize: {
        'xs': ['0.6875rem', { lineHeight: '1rem' }],
        'sm': ['0.8125rem', { lineHeight: '1.25rem' }],
        'base': ['0.875rem', { lineHeight: '1.25rem' }],
        'md': ['0.9375rem', { lineHeight: '1.5rem' }],
        'lg': ['1.0625rem', { lineHeight: '1.5rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      spacing: {
        'sidebar-expanded': '260px',
        'sidebar-collapsed': '64px',
        'topnav': '56px',
      },
      boxShadow: {
        'xs': '0 1px 2px rgba(0, 0, 0, 0.04)',
        'focus': '0 0 0 3px rgba(249, 125, 9, 0.18)',
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'fade-in-up': 'fadeInUp 300ms ease-out',
        'slide-in-left': 'slideInLeft 300ms ease-out',
        'slide-in-right': 'slideInRight 300ms ease-out',
        'scale-in': 'scaleIn 200ms ease-out',
        'shimmer': 'shimmer 1.5s infinite',
        'pulse-soft': 'pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(100%)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
