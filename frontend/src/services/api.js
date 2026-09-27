let tokenProvider = async () => null;
export const setAuthTokenProvider = (provider) => {
  tokenProvider = provider || (async () => null);
};
/** Same JSON boundary for MSW and FastAPI. No credentials enter local storage. */
export async function api(path, options = {}) {
  const token = await tokenProvider();
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request could not be completed. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
export const post = (path, body = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const demoMode = import.meta.env.VITE_DEMO_MODE !== "false";
export const testAuth = import.meta.env.VITE_TEST_AUTH === "true";
/** Read validated results and operational progress, never partial legal answers. */
export async function streamPost(path, body, onProgress, { signal } = {}) {
  const token = await tokenProvider();
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    signal,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Request failed. Please retry.",
    );
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw new Error("Expected a progress stream. Please retry.");
  return readEvents(response.body, onProgress);
}

export async function readEvents(body, onProgress) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        throw new Error(
          "Connection ended before the answer arrived. Retry to recover it.",
        );
      buffer += value;
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let event = "message";
        const data = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:"))
            data.push(line.slice(5).replace(/^ /, ""));
        }
        if (!data.length) continue;
        const payload = JSON.parse(data.join("\n"));
        if (event === "error")
          throw new Error(payload.detail || "Request failed. Please retry.");
        if (event === "result") return payload;
        if (event === "progress") onProgress(payload);
      }
      if (buffer.length > 2_000_000)
        throw new Error("Progress response exceeded the size limit.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function download(name, content) {
  const url = URL.createObjectURL(
    new Blob(
      [
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2),
      ],
      {
        type:
          typeof content === "string"
            ? "text/plain;charset=utf-8"
            : "application/json",
      },
    ),
  );
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: name,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
