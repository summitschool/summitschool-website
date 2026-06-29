/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './members.html', './confirm-email.html', './assets/app-dialog.js'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0A2540',
          light: '#1E3A5F',
        },
        gold: '#C9A227',
        sage: '#7C8F7E',
        ivory: '#FDFBF7',
        cream: '#F5F0E6',
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};