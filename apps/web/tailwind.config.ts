import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        zband: {
          green: '#16a34a',
          yellow: '#eab308',
          orange: '#f97316',
          red: '#dc2626',
        },
      },
    },
  },
  plugins: [],
};

export default config;
