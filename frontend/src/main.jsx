import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/noto-sans-devanagari/devanagari-400.css";
import "@fontsource/noto-sans-devanagari/devanagari-500.css";
import "./locales";
import "./theme/styles.css";
import { Providers } from "./app/providers";
import App from "./app/App";
import { demoMode, testAuth } from "./services/api";
import { ClerkProvider } from "@clerk/react";
async function start() {
  if (demoMode) {
    const { worker } = await import("./mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass", quiet: true });
  }
  const application = (
    <React.StrictMode>
      <BrowserRouter>
        <Providers>
          <App />
        </Providers>
      </BrowserRouter>
    </React.StrictMode>
  );
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!demoMode && !testAuth && !publishableKey)
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required in live mode");
  ReactDOM.createRoot(document.getElementById("root")).render(
    demoMode || testAuth ? application : (
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
        {application}
      </ClerkProvider>
    ),
  );
}
start().catch(() => {
  document.getElementById("root").textContent =
    "The workspace could not start. Please reload; demo mode requires a browser that supports service workers on localhost or HTTPS.";
});
