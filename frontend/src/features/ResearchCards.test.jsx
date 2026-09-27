import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "../locales";
import {
  ClarificationCard,
  EvidenceReview,
  ResearchProgress,
  recordProgress,
} from "./ResearchCards";

afterEach(cleanup);

test("a clarification selection requires Continue and respects disabled history", () => {
  const choose = vi.fn();
  const custom = vi.fn();
  const props = {
    options: ["Medicine", "Food"],
    onChoose: choose,
    onCustom: custom,
  };
  const { rerender } = render(<ClarificationCard {...props} />);
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Medicine/ }));
  expect(choose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(choose).toHaveBeenCalledWith("Medicine");
  fireEvent.click(screen.getByRole("button", { name: "Write my own answer" }));
  expect(custom).toHaveBeenCalledOnce();
  rerender(<ClarificationCard {...props} disabled />);
  expect(screen.getByRole("radio", { name: /Food/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("progress preserves real repair attempts without inventing completed steps", () => {
  let events = [];
  for (const event of [
    { stage: "generate", status: "running" },
    { stage: "generate", status: "complete", elapsed_ms: 1250 },
    { stage: "validate", status: "running" },
    { stage: "validate", status: "complete", elapsed_ms: 300 },
    { stage: "generate", status: "running" },
  ])
    events = recordProgress(events, event);
  expect(events).toHaveLength(3);
  expect(events[2].status).toBe("running");
  expect(
    recordProgress(events, { stage: "retrieve", status: "complete" }),
  ).toEqual(events);
  render(<ResearchProgress events={events} demo={false} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Preparing a sourced answer",
  );
  expect(screen.getByText("1.3 s")).toBeVisible();
  expect(
    screen.queryByText("Retrieving reviewed sources"),
  ).not.toBeInTheDocument();
});

test("demo evidence cards never report automated approval", () => {
  render(
    <EvidenceReview
      answer={{
        evidence_review: { kind: "demo" },
        confidence_reasons: ["Scripted example"],
      }}
    />,
  );
  expect(screen.getByText("Demo · live checks not performed")).toBeVisible();
  expect(screen.queryByText(/automated checks passed/)).not.toBeInTheDocument();
});
