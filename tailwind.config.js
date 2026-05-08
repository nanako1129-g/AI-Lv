/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        cute: ['"M PLUS Rounded 1c"', "ui-rounded", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 40px -12px rgba(15, 23, 42, 0.08)",
        "card-hover":
          "0 1px 2px rgba(15, 23, 42, 0.06), 0 20px 50px -16px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};
