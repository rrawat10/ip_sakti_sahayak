import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { Providers, useAuth, usePreferences } from "./providers";
import { SourceDrawer } from "../components/Common";
import { api, post } from "../services/api";
import i18n from "../locales";

vi.mock("../services/api", () => ({
  api: vi.fn(),
  post: vi.fn(),
  demoMode: true,
  testAuth: false,
  setAuthTokenProvider: vi.fn(),
}));
let client;
function Session() {
  client = useQueryClient();
  const auth = useAuth();
  const preferences = usePreferences();
  return (
    <>
      <span>{auth.user?.name || "Anonymous"}</span>
      <span>{auth.error?.message}</span>
      <span>{preferences.mode}</span>
      <button onClick={() => auth.login("login", {})}>Login</button>
      <button onClick={() => auth.logout()}>Logout</button>
      <button onClick={() => preferences.setMode("dark")}>Dark</button>
    </>
  );
}
beforeEach(async () => {
  api.mockResolvedValue(null);
  post.mockReset();
  localStorage.clear();
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
});

it("restores document language and rejects invalid persisted themes", async () => {
  localStorage.setItem("sakti-theme", "invalid");
  await i18n.changeLanguage("hi");
  render(
    <Providers>
      <Session />
    </Providers>,
  );
  expect(document.documentElement.lang).toBe("hi");
  expect(screen.getByText("light")).toBeInTheDocument();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  fireEvent.click(screen.getByText("Dark"));
  expect(screen.getByText("dark")).toBeInTheDocument();
});

it("cancels stale session requests and removes previous account data on login and logout", async () => {
  let resolveSession;
  api.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
  );
  post.mockResolvedValue({ user: { name: "New account" } });
  render(
    <Providers>
      <Session />
    </Providers>,
  );
  client.setQueryData(["consultations"], [{ id: "private-old-account" }]);
  fireEvent.click(screen.getByText("Login"));
  await screen.findByText("New account");
  expect(client.getQueryData(["consultations"])).toBeUndefined();
  await act(async () => resolveSession({ user: { name: "Old account" } }));
  expect(screen.getByText("New account")).toBeInTheDocument();
  client.setQueryData(["consultations"], [{ id: "new-private" }]);
  fireEvent.click(screen.getByText("Logout"));
  await screen.findByText("Anonymous");
  expect(client.getQueryData(["consultations"])).toBeUndefined();
});

it("preserves server errors while treating an expired session as signed out", async () => {
  api.mockRejectedValueOnce(
    Object.assign(new Error("Unauthorized"), { status: 401 }),
  );
  render(
    <Providers>
      <Session />
    </Providers>,
  );
  await waitFor(() => expect(client.getQueryData(["session"])).toBeNull());
  api.mockRejectedValueOnce(
    Object.assign(new Error("Service unavailable"), { status: 503 }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ["session"] });
  });
  expect(await screen.findByText("Service unavailable")).toBeInTheDocument();
});

const source = {
  id: "act",
  title: "Official Act",
  authority: "Authority",
  scope: "india",
  locator: "Section 3",
  url: "https://example.org/act",
  version_id: "v1",
  checked_at: "2026-09-15",
};
it("copies a complete citation and names the drawer for assistive technology", async () => {
  const writeText = vi.fn().mockResolvedValue();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<SourceDrawer source={source} onClose={() => {}} />);
  expect(
    screen.getByRole("dialog", { name: source.title }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Copy citation"));
  expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining(
      "Official Act\nAuthority\nSection 3\nhttps://example.org/act\nVersion: v1\nReference check date: 2026-09-15",
    ),
  );
  vi.unstubAllGlobals();
});

it("provides selectable citation text when clipboard access fails and resets for another source", async () => {
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: vi.fn().mockRejectedValue(new Error("Permission denied")),
    },
  });
  const { rerender } = render(
    <SourceDrawer source={source} onClose={() => {}} />,
  );
  fireEvent.click(screen.getByText("Copy citation"));
  const fallback = await screen.findByRole("textbox", { name: "Citation" });
  expect(fallback).toHaveAttribute("readonly");
  expect(fallback.value).toContain(source.url);
  rerender(
    <SourceDrawer
      source={{ ...source, id: "next", title: "Next source" }}
      onClose={() => {}}
    />,
  );
  expect(
    screen.queryByRole("textbox", { name: "Citation" }),
  ).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});
