import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "../locales";
const mocks = vi.hoisted(() => ({ api: vi.fn(), post: vi.fn() }));
vi.mock("../services/api", () => ({ ...mocks, demoMode: false }));
import { VoiceInput } from "./Speech";

afterEach(() => vi.unstubAllGlobals());

test("closing voice input while availability loads never requests microphone access", async () => {
  let resolve;
  mocks.api.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const microphone = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: microphone } });
  render(<VoiceInput onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /voice/i }));
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => resolve({ available: true, asr: true }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(microphone).not.toHaveBeenCalled();
});
