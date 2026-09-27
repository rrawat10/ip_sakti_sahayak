import { setupWorker } from "msw/browser";
import { http, HttpResponse, delay } from "msw";
import { makeConsultation, demoAnswer, seedSources, scopes } from "./scenarios";
const key = "sakti-demo-v1";
const initial = () => ({ user: null, consultations: [], feedback: [] });
function load() {
  try {
    return JSON.parse(sessionStorage.getItem(key)) || initial();
  } catch {
    return initial();
  }
}
let db = load();
const save = () => sessionStorage.setItem(key, JSON.stringify(db));
const json = HttpResponse.json;
const unauthorized = () =>
  json({ detail: "Please sign in to continue." }, { status: 401 });
const handlers = [
  http.post("/api/v1/demo/messages/stream", async ({ request }) => {
    const body = await request.json();
    let context = {};
    for (const message of body.history || []) {
      if (message.role === "user" && message.scope === body.scope)
        context = demoAnswer(message.content, body.scope, body.language, context).context;
    }
    const answer = demoAnswer(body.content, body.scope, body.language, context);
    return new HttpResponse(`event: result\ndata: ${JSON.stringify({ answer })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }),
  http.get("/api/v1/connectors/grants", () =>
    db.user ? json([]) : unauthorized(),
  ),
  http.get("/api/v1/auth/export", () =>
    db.user
      ? json({ user: db.user, consultations: db.consultations })
      : unauthorized(),
  ),
  http.get("/api/v1/auth/me", () =>
    db.user ? json({ user: db.user }) : unauthorized(),
  ),
  ...["login", "register"].map((action) =>
    http.post(`/api/v1/auth/${action}`, async ({ request }) => {
      const body = await request.json();
      db.user = {
        id: "demo-user",
        name: body.name || "Researcher",
        email: body.email || "researcher@example.com",
      };
      save();
      return json({ user: db.user });
    }),
  ),
  http.post("/api/v1/auth/logout", () => {
    db.user = null;
    save();
    return json({ ok: true });
  }),
  http.delete("/api/v1/auth/account", () => {
    if (!db.user) return unauthorized();
    db = initial();
    save();
    return json({ ok: true });
  }),
  http.get("/api/v1/sources", () => json(seedSources)),
  http.get("/api/v1/documents/:id", ({ params }) => {
    const source = seedSources.find((s) => s.id === params.id);
    return source
      ? json(source)
      : json({ detail: "Source not found" }, { status: 404 });
  }),
  http.get("/api/v1/consultations", () =>
    db.user
      ? json(db.consultations.map(({ messages, ...rest }) => rest))
      : unauthorized(),
  ),
  http.post("/api/v1/consultations", async ({ request }) => {
    if (!db.user) return unauthorized();
    const body = await request.json();
    const c = makeConsultation(body.title);
    db.consultations.unshift(c);
    save();
    return json(c);
  }),
  http.get("/api/v1/consultations/:id", ({ params }) => {
    if (!db.user) return unauthorized();
    const c = db.consultations.find((x) => x.id === params.id);
    return c
      ? json(c)
      : json({ detail: "Consultation not found" }, { status: 404 });
  }),
  http.patch("/api/v1/consultations/:id", async ({ params, request }) => {
    if (!db.user) return unauthorized();
    const c = db.consultations.find((x) => x.id === params.id);
    if (!c) return json({ detail: "Not found" }, { status: 404 });
    c.title = (await request.json()).title;
    save();
    return json(c);
  }),
  http.delete("/api/v1/consultations/:id", ({ params }) => {
    if (!db.user) return unauthorized();
    db.consultations = db.consultations.filter((x) => x.id !== params.id);
    save();
    return json({ ok: true });
  }),
  http.post(
    "/api/v1/consultations/:id/messages",
    async ({ params, request }) => {
      if (!db.user) return unauthorized();
      const c = db.consultations.find((x) => x.id === params.id);
      if (!c) return json({ detail: "Not found" }, { status: 404 });
      const body = await request.json();
      if (!scopes.includes(body.scope) || !body.content?.trim())
        return json({ detail: "Invalid message" }, { status: 422 });
      const prior = c.messages.find(
        (m) => m.request_id === body.request_id && m.role === "assistant",
      );
      if (prior) return json(c);
      await delay(650);
      const answer = demoAnswer(
        body.content,
        body.scope,
        body.language,
        c.assessments[body.scope],
      );
      c.messages.push(
        {
          id: crypto.randomUUID(),
          role: "user",
          scope: body.scope,
          content: body.content,
          request_id: body.request_id,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          scope: body.scope,
          answer,
          request_id: body.request_id,
        },
      );
      c.assessments[body.scope] = answer.context;
      c.updated_at = new Date().toISOString();
      if (c.messages.length === 2) c.title = body.content.slice(0, 65);
      save();
      return json(c);
    },
  ),
  http.post("/api/v1/feedback", async ({ request }) => {
    if (!db.user) return unauthorized();
    db.feedback.push(await request.json());
    save();
    return json({ ok: true });
  }),
  http.get("/api/v1/connectors", () =>
    json({ connectors: [], detail: "No paid-source provider is connected." }),
  ),
  http.get("/api/v1/speech/status", () => json({ available: false })),
];
export const worker = setupWorker(...handlers);
