const { fontFamily } = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */

module.exports = {
  darkMode: ['selector'],
  content: [
    './src/pages/**/*.tsx',
    './src/components/**/*.tsx',
    './src/layouts/**/*.tsx',
    './src/features/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1536px',
      },
    },
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      '3xl': '1780px',
      '4xl': '1980px',
    },
    extend: {
      borderWidth: {
        0.5: '0.5px',
      },
      colors: {
        border: 'var(--border-default)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'var(--background)',
        foreground: 'var(--colors-text-neutral-strong)',
        buttonBlueText: 'var(--button-blue-text)',

        'colors-outline-sentiment-primary':
          'var(--colors-outline-sentiment-primary)',
        'colors-outline-neutral-strong': 'var(--colors-outline-neutral-strong)',
        'colors-outline-neutral-standard':
          'var(--colors-outline-neutral-standard)',

        'colors-text-core-standard': 'var(--colors-text-core-standard)',
        'colors-text-neutral-strong': 'var(--colors-text-neutral-strong)',
        'colors-text-neutral-standard': 'var(--colors-text-neutral-standard)',
        'colors-text-neutral-weak': 'var(--colors-text-neutral-weak)',
        'colors-text-functional-danger': 'var(--colors-text-functional-danger)',
        'colors-text-inverse-strong': 'var(--colors-text-inverse-strong)',
        'colors-text-persist-light': 'var(--colors-text-persist-light)',
        'colors-text-inverse-weak': 'var(--colors-text-inverse-weak)',

        'background-badge': 'var(--background-badge)',
        'text-badge': 'var(--text-badge)',
        'text-title': 'var(--text-title)',
        'text-sub-title': 'var(--text-sub-title)',
        'text-sub-title-invert': 'var(--text-sub-title-invert)',
        'text-title-invert': 'var(--text-title-invert)',
        'background-header-bar': 'var(--background-header-bar)',
        'background-card': 'var(--background-card)',
        'background-note': 'var(--background-note)',
        'background-highlight': 'var(--background-highlight)',

        'input-border': 'var(--input-border)',

        /* design colors */
        'bg-title': 'var(--bg-title)',
        'bg-base': 'var(--bg-base)',
        'bg-card': 'var(--bg-card)',
        'bg-component': 'var(--bg-component)',
        'bg-input': 'var(--bg-input)',
        'bg-canvas': {
          DEFAULT: 'rgb(var(--bg-canvas) / <alpha-value>)',
        },
        'bg-list': {
          DEFAULT: 'rgb(var(--bg-list) / <alpha-value>)',
        },
        'text-primary': {
          DEFAULT: 'rgb(var(--text-primary) / <alpha-value>)',
        },
        'text-primary-inverse': {
          DEFAULT: 'rgb(var(--text-primary-inverse) / <alpha-value>)',
        },
        'text-secondary': {
          DEFAULT: 'rgb(var(--text-secondary) / <alpha-value>)',
        },
        'text-secondary-inverse': {
          DEFAULT: 'rgb(var(--text-secondary-inverse) / <alpha-value>)',
        },
        'text-disabled': 'var(--text-disabled)',
        'text-input-tip': 'var(--text-input-tip)',
        'border-default': 'var(--border-default)',
        'border-accent': 'var(--border-accent)',
        'border-button': 'var(--border-button)',
        'accent-primary': {
          DEFAULT: 'rgb(var(--accent-primary) / <alpha-value>)',
          5: 'rgba(var(--accent-primary) / 0.05)', // 5%
        },
        'bg-accent': 'var(--bg-accent)',
        'state-success': {
          DEFAULT: 'rgb(var(--state-success) / <alpha-value>)',
          5: 'rgba(var(--state-success) / 0.05)', // 5%
        },
        'state-warning': {
          DEFAULT: 'rgb(var(--state-warning) / <alpha-value>)',
          5: 'rgba(var(--state-warning) / 0.05)', // 5%
        },
        'state-error': {
          DEFAULT: 'rgb(var(--state-error) / <alpha-value>)',
          5: 'rgba(var(--state-error) / 0.05)', // 5%
        },
        'team-group': 'var(--team-group)',
        'team-member': 'var(--team-member)',
        'team-department': 'var(--team-department)',
        'bg-group': 'var(--bg-group)',
        'bg-member': 'var(--bg-member)',
        'bg-department': 'var(--bg-department)',

        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'var(--background-inverse-strong)',
          foreground: 'var(--background-inverse-strong-foreground)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'var(--background-inverse-standard)',
          foreground: 'var(--background-inverse-standard-foreground)',
        },
        backgroundCoreWeak: {
          DEFAULT: 'var(--background-core-weak)',
          foreground: 'var(--background-core-weak-foreground)',
        },
        'colors-background-inverse-standard': {
          DEFAULT: 'var(--colors-background-inverse-standard)',
          foreground: 'var(--colors-background-inverse-standard-foreground)',
        },
        'colors-background-inverse-strong': {
          DEFAULT: 'var(--colors-background-inverse-strong)',
          foreground: 'var(--background-inverse-standard-foreground)',
        },
        'colors-background-neutral-standard': {
          DEFAULT: 'var(--colors-background-neutral-standard)',
          foreground: 'var(--background-inverse-standard-foreground)',
        },
        'colors-background-neutral-strong': {
          DEFAULT: 'var(--colors-background-neutral-strong)',
          foreground: 'var(--background-inverse-standard-foreground)',
        },
        'colors-background-neutral-weak': {
          DEFAULT: 'var(--colors-background-neutral-weak)',
          foreground: 'var(--background-inverse-standard-foreground)',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        // spec-013 P0-2: TRAE Work Token 颜色映射(权威源 var(--trae-xxx))
        trae: {
          green: {
            DEFAULT: 'var(--trae-green)',
            dim: 'var(--trae-green-dim)',
            bright: 'var(--trae-green-bright)',
            glow: 'var(--trae-green-glow)',
            soft: 'var(--trae-green-soft)',
            tint: 'var(--trae-green-tint)',
            border: 'var(--trae-green-border)',
          },
          ink: {
            DEFAULT: 'var(--trae-ink)',
            2: 'var(--trae-ink-2)',
          },
          grey: {
            DEFAULT: 'var(--trae-grey)',
            2: 'var(--trae-grey-2)',
          },
          line: {
            DEFAULT: 'var(--trae-line)',
            strong: 'var(--trae-line-strong)',
          },
          card: 'var(--trae-card-bg)',
          nav: 'var(--trae-nav-bg)',
          surface: 'var(--trae-surface)',
        },
      },
      backgroundImage: {
        'metallic-gradient':
          'linear-gradient(104deg, rgb(var(--text-primary)) 30%, var(--metallic) 50%, rgb(var(--text-primary)) 70%)',
        // spec-013 P2-B3: TRAE Work 卡片悬停渐变映射(替代任意值语法 bg-[image:var(--trae-card-bg-hover)])
        'trae-card-hover': 'var(--trae-card-bg-hover)',
      },
      borderRadius: {
        px: '1px',

        '4xl': '1rem' /* 16px */,
        '3xl': '0.75rem' /* 12px */,
        '2xl': '0.625rem' /* 10px */,
        xl: '0.5rem' /* 8px */,
        lg: '0.4375rem' /* 7px */,
        DEFAULT: '0.375rem' /* 6px */,
        sm: '0.3125rem' /* 5px */,
        xs: '0.25rem' /* 4px */,
        '2xs': '0.1875rem' /* 3px */,
        '3xs': '0.125' /* 2px */,
        // spec-013 P0-2: TRAE Work 圆角映射
        'trae-xs': 'var(--trae-radius-xs)',
        'trae-sm': 'var(--trae-radius-sm)',
        'trae-md': 'var(--trae-radius-md)',
        'trae-lg': 'var(--trae-radius-lg)',
        'trae-xl': 'var(--trae-radius-xl)',
        'trae-2xl': 'var(--trae-radius-2xl)',
        'trae-3xl': 'var(--trae-radius-3xl)',
        'trae-full': 'var(--trae-radius-full)',
      },
      // spec-013 P0-2: TRAE Work 字号映射(含行高)
      fontSize: {
        'trae-xs': ['var(--trae-text-xs)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-sm': ['var(--trae-text-sm)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-sm-2': ['var(--trae-text-sm-2)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-base': ['var(--trae-text-base)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-md': ['var(--trae-text-md)', { lineHeight: 'var(--trae-leading-relaxed)' }],
        'trae-lg': ['var(--trae-text-lg)', { lineHeight: 'var(--trae-leading-2)' }],
        'trae-xl': ['var(--trae-text-xl)', { lineHeight: 'var(--trae-leading-normal)' }],
        'trae-2xl': ['var(--trae-text-2xl)', { lineHeight: 'var(--trae-leading-snug)' }],
        'trae-3xl': ['var(--trae-text-3xl)', { lineHeight: 'var(--trae-leading-tight)' }],
        'trae-4xl': ['var(--trae-text-4xl)', { lineHeight: 'var(--trae-leading-tight)' }],
        'trae-5xl': ['var(--trae-text-5xl)', { lineHeight: 'var(--trae-leading-tight)' }],
      },
      // spec-013 P0-2: TRAE Work 阴影映射
      boxShadow: {
        'trae-glow-sm': 'var(--trae-shadow-glow-sm)',
        'trae-glow-md': 'var(--trae-shadow-glow-md)',
        'trae-cta-hover': 'var(--trae-shadow-cta-hover)',
        'trae-elev-1': 'var(--trae-shadow-elev-1)',
        'trae-elev-2': 'var(--trae-shadow-elev-2)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
        // spec-013 P0-2: TRAE Work 字体映射
        display: ['var(--trae-font-display)', ...fontFamily.sans],
        mono: ['var(--trae-font-mono)', 'ui-monospace', 'monospace'],
      },
      // spec-013 P0-2: TRAE Work 字间距映射
      letterSpacing: {
        'trae-tight': 'var(--trae-tracking-tight)',
        'trae-wide': 'var(--trae-tracking-wide)',
        'trae-wider': 'var(--trae-tracking-wider)',
        'trae-widest': 'var(--trae-tracking-widest)',
      },
      // spec-013 P0-2: TRAE Work 过渡时长映射
      transitionDuration: {
        'trae-fast': 'var(--trae-transition-fast)',
        'trae-base': 'var(--trae-transition-base)',
        'trae-slow': 'var(--trae-transition-slow)',
        'trae-x-slow': 'var(--trae-transition-x-slow)',
      },
      // spec-013 P0-2: TRAE Work 毛玻璃模糊映射
      backdropBlur: {
        'trae-nav': 'var(--trae-blur-nav)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'caret-blink': {
          '0%,70%,100%': { opacity: '1' },
          '20%,50%': { opacity: '0' },
        },
        'spin-reverse': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(-360deg)' },
        },
        'bell-shake': {
          '0%,25%': { transform: 'rotate(0)', transformOrigin: 'center 25% ' },
          '3.125%': { transform: 'rotate(-12.5deg)' },
          '9.375%': { transform: 'rotate(11deg)' },
          '15.625%': { transform: 'rotate(-9.5deg)' },
          '21.875%': { transform: 'rotate(7.5deg)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
        'spin-reverse': 'spin-reverse 1s linear infinite',
        'bell-shake':
          'bell-shake 2s 1s cubic-bezier(0.33, 1, 0.68, 1) infinite',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/line-clamp'),
    require('tailwind-scrollbar'),
    require('@tailwindcss/container-queries'),
  ],
};
