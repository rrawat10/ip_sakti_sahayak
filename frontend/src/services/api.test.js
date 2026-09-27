// @vitest-environment node
import { expect, test } from "vitest";
import { readEvents } from "./api";

function stream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      // Split every byte to exercise partial UTF-8 characters and CRLF boundaries.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}

test("streams progress and returns the final validated result", async () => {
  const events = [];
  const result = await readEvents(
    stream(
      ': heartbeat\r\n\r\nevent: progress\r\ndata: {"stage":"retrieve"}\r\n\r\n' +
        'event: result\ndata: {"answer":"नमस्ते"}\n\n',
    ),
    (event) => events.push(event),
  );
  expect(events).toEqual([{ stage: "retrieve" }]);
  expect(result).toEqual({ answer: "नमस्ते" });
});

test("an interrupted stream cannot become a completed answer", async () => {
  await expect(readEvents(stream(": heartbeat\n\n"), () => {})).rejects.toThrow(
    "before the answer",
  );
  await expect(
    readEvents(
      stream('event: error\ndata: {"detail":"Retry later"}\n\n'),
      () => {},
    ),
  ).rejects.toThrow("Retry later");
});
