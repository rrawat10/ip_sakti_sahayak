import { defineConfig } from "@playwright/test";
const python =
  process.platform === "win32"
    ? "..\\.venv\\Scripts\\python.exe"
    : "../.venv/bin/python";
export default defineConfig({
  testDir: "./e2e-api",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5174", screenshot: "only-on-failure" },
  webServer: [
    {
      command: `${python} -m uvicorn e2e_server:app --app-dir ../backend/tests --host 127.0.0.1 --port 8001`,
      url: "http://127.0.0.1:8001/api/health/live",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5174 --strictPort",
      env: {
        VITE_DEMO_MODE: "false",
        VITE_TEST_AUTH: "true",
        API_PROXY_TARGET: "http://127.0.0.1:8001",
      },
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
    },
  ],
});
