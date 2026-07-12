/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './members.html',
    './confirm-email.html',
    './enrollment-complete.html',
    './enrollment-returning.html',
    './enrollment-new-family.html',
    './assets/app-dialog.js',
    './assets/family-picker.js',
  ],
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