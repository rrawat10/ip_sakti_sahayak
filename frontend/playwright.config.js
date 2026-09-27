import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5175", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev -- --port 5175 --strictPort",
    env: { VITE_DEMO_MODE: "true" },
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
