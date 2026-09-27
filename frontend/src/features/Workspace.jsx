import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Drawer,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  Plus,
  Search,
  MessageSquare,
  BookOpen,
  Library,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  PanelRightClose,
  ArrowUp,
  Mic,
  Globe2,
  Scale,
  FlaskConical,
  Sprout,
  ArrowUpRight,
  Download,
  Pencil,
  Trash2,
  X,
  LogOut,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../app/providers";
import { api, post, streamPost, download, demoMode } from "../services/api";
import {
  Brand,
  IconAction,
  ModeLabel,
  SourceDrawer,
  Loading,
  ErrorNotice,
} from "../components/Common";
import Answer from "./Answer";
import { VoiceInput } from "./Speech";
import Brief from "./Brief";
import { ResearchProgress, recordProgress } from "./ResearchCards";
function ContextPanel({ context = {}, scope, onScopeChange, disabled, onClose }) {
  const { t, i18n } = useTranslation();
  const hi = i18n.language === "hi";
  return (
    <aside className="context-panel">
      <div className="row between">
        <span className="eyebrow">{t("context")}</span>
        {onClose && (
          <IconAction label={t("close")} onClick={onClose}>
            <X size={18} />
          </IconAction>
        )}
      </div>
      <div className="context-scope">
        <Globe2 size={18} />
        <div>
          <small>{t("jurisdiction")}</small>
          <select
            aria-label={t("jurisdiction")}
            value={scope}
            disabled={disabled}
            onChange={(event) => onScopeChange(event.target.value)}
          >
            {["india", "international", "us", "eu", "uk"].map((value) => (
              <option key={value} value={value}>
                {t(value === "international" ? "frameworks" : value)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="small muted">{t("scopeNotice")}</p>
      {[
        ["product", "product"],
        ["classification", "classification"],
        ["ip", "ip"],
        ["regulatory", "regulatory"],
        ["abs", "abs"],
      ].map(([label, key]) => (
        <section className="context-section" key={key}>
          <h3>{t(label)}</h3>
          <span className={context[key] ? "context-value" : "unknown-value"}>
            {context[key] || t("unknown")}
          </span>
        </section>
      ))}
      {context.intended_use && (
        <section className="context-section">
          <h3>{t("facts")}</h3>
          <p>{context.intended_use}</p>
          {context.classical_basis && <p>{context.classical_basis}</p>}
        </section>
      )}
      <div className="context-note">
        <ShieldCheck size={18} />
        <p>
          {hi
            ? "आकलन आपके बताए तथ्यों और उपलब्ध साक्ष्यों पर निर्भर है।"
            : "Assessments depend on the facts you provide and the evidence available."}
        </p>
      </div>
      <Link to="/about" className="expert-link">
        {t("support")}
        <ArrowUpRight size={15} />
      </Link>
    </aside>
  );
}
export default function Workspace({ temporary = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState("india");
  const [text, setText] = useState(params.get("prompt") || "");
  const [search, setSearch] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [source, setSource] = useState(null);
  const [notice, setNotice] = useState("");
  const [edit, setEdit] = useState(null);
  const [title, setTitle] = useState("");
  const end = useRef(null);
  const composer = useRef(null);
  const pendingRequest = useRef(null);
  const [progress, setProgress] = useState([]);
  const [temporaryConsultations, setTemporaryConsultations] = useState([]);
  const [temporaryId, setTemporaryId] = useState(null);
  const activeId = temporary ? temporaryId : id;
  const savedHistory = useQuery({
    queryKey: ["consultations"],
    queryFn: () => api("/consultations"),
    enabled: !temporary,
  });
  const savedConsultation = useQuery({
    queryKey: ["consultation", id],
    queryFn: () => api(`/consultations/${id}`),
    enabled: !temporary && !!id,
  });
  const history = temporary
    ? { data: temporaryConsultations, isPending: false, error: null }
    : savedHistory;
  const consultation = temporary
    ? { isPending: false, error: null }
    : savedConsultation;
  const current = temporary
    ? temporaryConsultations.find((item) => item.id === temporaryId)
    : savedConsultation.data;
  const messages = current?.messages.filter((m) => m.scope === scope) || [];
  const mutation = useMutation({
    mutationFn: async (content) => {
      setProgress([]);
      const signature = JSON.stringify([content, scope, i18n.language]);
      if (pendingRequest.current?.signature !== signature)
        pendingRequest.current = {
          signature,
          id: activeId,
          requestId: crypto.randomUUID(),
        };
      let active = pendingRequest.current.id;
      if (temporary) {
        const createdAt = new Date().toISOString();
        const base = current || {
          id: active || crypto.randomUUID(),
          title: content.slice(0, 65),
          created_at: createdAt,
          updated_at: createdAt,
          facts: {},
          assessments: { india: {}, international: {}, us: {}, eu: {}, uk: {} },
          messages: [],
        };
        pendingRequest.current.id = base.id;
        const result = await streamPost(
          "/demo/messages/stream",
          {
            content,
            scope,
            language: i18n.language,
            request_id: pendingRequest.current.requestId,
            history: base.messages.slice(-12).map((message) => ({
              role: message.role,
              scope: message.scope,
              content: message.content || message.answer?.short_answer,
            })),
          },
          (event) => setProgress((previous) => recordProgress(previous, event)),
        );
        const updated = {
          ...base,
          updated_at: new Date().toISOString(),
          facts: { ...base.facts, ...(result.answer.context || {}) },
          messages: [
            ...base.messages,
            { id: crypto.randomUUID(), role: "user", content, scope },
            { id: crypto.randomUUID(), role: "assistant", answer: result.answer, scope },
          ],
        };
        return updated;
      }
      if (!active) {
        const c = await post("/consultations", { title: content.slice(0, 65) });
        active = c.id;
        pendingRequest.current.id = active;
        queryClient.setQueryData(["consultation", active], c);
        navigate(`/consultations/${active}`, { replace: true });
      }
      const body = {
        content,
        scope,
        language: i18n.language,
        request_id: pendingRequest.current.requestId,
      };
      return demoMode
        ? post(`/consultations/${active}/messages`, body)
        : streamPost(
            `/consultations/${active}/messages/stream`,
            body,
            (event) =>
              setProgress((previous) => recordProgress(previous, event)),
          );
    },
    onSuccess: (result) => {
      pendingRequest.current = null;
      if (temporary) {
        setTemporaryId(result.id);
        setTemporaryConsultations((items) => [
          result,
          ...items.filter((item) => item.id !== result.id),
        ]);
        setText("");
        return;
      }
      queryClient.setQueryData(["consultation", result.id], result);
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      setText("");
    },
    onError: (e) => setNotice(e.message),
  });
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, mutation.isPending]);
  useEffect(() => {
    function shortcut(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        composer.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  async function editConsultation() {
    try {
      if (temporary) {
        if (edit === "delete") {
          setTemporaryConsultations((items) =>
            items.filter((item) => item.id !== activeId),
          );
          setTemporaryId(null);
        } else {
          setTemporaryConsultations((items) =>
            items.map((item) =>
              item.id === activeId ? { ...item, title: title.trim() } : item,
            ),
          );
        }
        setEdit(null);
        return;
      }
      if (edit === "delete") {
        await api(`/consultations/${id}`, { method: "DELETE" });
        navigate("/consultations");
      } else {
        await api(`/consultations/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: title.trim() }),
        });
        queryClient.invalidateQueries({ queryKey: ["consultation", id] });
      }
      queryClient.invalidateQueries({ queryKey: ["consultations"] });
      setEdit(null);
    } catch (e) {
      setNotice(e.message);
    }
  }
  const sidebar = (
    <aside className="workspace-sidebar">
      <div className="sidebar-brand">
        <Brand compact />
        <IconAction label={t("close")} onClick={() => setNavOpen(false)}>
          <PanelLeftClose size={16} />
        </IconAction>
      </div>
      <Button
        className="new-button"
        disabled={mutation.isPending}
        variant="contained"
        startIcon={<Plus size={17} />}
        onClick={() => {
          if (temporary) setTemporaryId(null);
          else navigate("/consultations");
          setText("");
          setNavOpen(false);
          mutation.reset();
          pendingRequest.current = null;
        }}
      >
        {t("newConsultation")}
      </Button>
      <div className="sidebar-search">
        <Search size={15} />
        <input
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <kbd>⌘ K</kbd>
      </div>
      <span className="eyebrow sidebar-label">{t("consultations")}</span>
      <div className="history-list">
        {history.isPending ? (
          <Loading />
        ) : history.error ? (
          <ErrorNotice error={history.error} retry={history.refetch} />
        ) : history.data.length === 0 ? (
          <p className="history-empty">
            {i18n.language === "hi"
              ? "आपका शोध यहाँ दिखाई देगा।"
              : "Your research will find a home here."}
          </p>
        ) : (
          ["today", "earlier"].map((group) => {
            const rows = history.data.filter(
              (c) =>
                c.title.toLowerCase().includes(search.toLowerCase()) &&
                (new Date(c.updated_at).toDateString() ===
                  new Date().toDateString()) ===
                  (group === "today"),
            );
            return (
              rows.length > 0 && (
                <div key={group}>
                  <h4>{t(group)}</h4>
                  {rows.map((c) => (
                    <Link
                      key={c.id}
                      to={temporary ? "/demo" : `/consultations/${c.id}`}
                      className={`history-item ${activeId === c.id ? "active" : ""}`}
                      onClick={(event) => {
                        if (mutation.isPending) {
                          event.preventDefault();
                          return;
                        }
                        if (temporary) setTemporaryId(c.id);
                        setNavOpen(false);
                        setText("");
                        pendingRequest.current = null;
                      }}
                    >
                      <MessageSquare size={15} />
                      <span>{c.title}</span>
                    </Link>
                  ))}
                </div>
              )
            );
          })
        )}
      </div>
      <div className="sidebar-tools">
        <span className="eyebrow">{t("tools")}</span>
        <Link to="/library">
          <Library size={17} />{t("library")}<ArrowUpRight size={13} />
        </Link>
        <Link to={temporary ? "/sign-up" : "/settings"}>
          <Settings2 size={17} />
          {t("settings")}
        </Link>
      </div>
      <div className="sidebar-session">
        <ModeLabel demo={temporary || demoMode} />
        <div className="sidebar-profile">
          <span className="profile-avatar">{user?.name?.[0] || "R"}</span>
          <div>
            <strong>{temporary ? t("demo") : user?.name}</strong>
            <small>{temporary || demoMode ? t("demo") : user?.email}</small>
          </div>
          <IconAction
            label={t("signOut")}
            onClick={async () => {
              try {
                if (temporary) {
                  navigate("/sign-up");
                  return;
                }
                await logout();
                navigate("/sign-in");
              } catch (e) {
                setNotice(e.message);
              }
            }}
          >
            <LogOut size={16} />
          </IconAction>
        </div>
      </div>
    </aside>
  );
  const prompts = [
    ["patentPrompt", Scale],
    ["classPrompt", FlaskConical],
    ["absPrompt", Sprout],
    ["priorPrompt", BookOpen],
  ];
  return (
    <div className="workspace-shell">
      <div className={`desktop-sidebar ${leftPanelOpen ? "" : "is-collapsed"}`}>{sidebar}</div>
      <Drawer open={navOpen} onClose={() => setNavOpen(false)}>
        {sidebar}
      </Drawer>
      <div className="workspace-body">
        <header className="workspace-header">
          <div className="row">
            <span className="desktop-left-toggle">
              <IconAction
                label={leftPanelOpen ? "Hide consultation history" : "Show consultation history"}
                onClick={() => setLeftPanelOpen((open) => !open)}
              >
                {leftPanelOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
              </IconAction>
            </span>
            <span className="mobile-nav-button">
              <IconAction label={t("menu")} onClick={() => setNavOpen(true)}>
                <PanelLeftClose size={20} />
              </IconAction>
            </span>
            <span className="workspace-breadcrumb">
              {t("workspace")}
              <ChevronRight size={14} />
              <strong>{current?.title || t("newConsultation")}</strong>
            </span>
          </div>
          <div className="row">
            <div className="consultation-tools">
              {activeId && (
                <>
                  <Brief consultation={current} />
                  <IconAction label={t("export")} onClick={() => download("ip-sakti-consultation.json", current)}>
                    <Download size={16} />
                  </IconAction>
                  <IconAction label={t("rename")} onClick={() => { setTitle(current?.title || ""); setEdit("rename"); }}>
                    <Pencil size={16} />
                  </IconAction>
                  <IconAction label={t("delete")} onClick={() => setEdit("delete")}>
                    <Trash2 size={16} />
                  </IconAction>
                </>
              )}
            </div>
            <span className="desktop-context-toggle">
              <IconAction
                label={rightPanelOpen ? "Hide consultation context" : t("viewContext")}
                onClick={() => setRightPanelOpen((open) => !open)}
              >
                {rightPanelOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
              </IconAction>
            </span>
            <span className="mobile-context-toggle">
              <IconAction label={t("viewContext")} onClick={() => setContextOpen(true)}>
                <PanelRightOpen size={19} />
              </IconAction>
            </span>
          </div>
        </header>
        <div className="workspace-columns">
          <main className="conversation">
            <div className="conversation-scroll">
              {activeId && consultation.isPending ? (
                <Loading />
              ) : consultation.error ? (
                <ErrorNotice
                  error={consultation.error}
                  retry={consultation.refetch}
                />
              ) : messages.length === 0 ? (
                <div className="workspace-empty">
                  <div className="empty-emblem">
                    <BookOpen size={30} strokeWidth={1.2} />
                  </div>
                  <span className="eyebrow">{t("title")}</span>
                  <h1>{t("greeting")}</h1>
                  <p>{t("greetingSub")}</p>
                  <div className="prompt-grid">
                    {prompts.map(([key, Icon]) => (
                      <button
                        key={key}
                        disabled={mutation.isPending}
                        onClick={() => {
                          setText(t(key));
                          composer.current?.focus();
                        }}
                      >
                        <Icon size={21} strokeWidth={1.5} />
                        <span>{t(key)}</span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                  <div className="empty-bottom">
                    <ShieldCheck size={15} />
                    {i18n.language === "hi"
                      ? "स्रोत-जुड़ा मार्गदर्शन। स्पष्ट अनिश्चितता।"
                      : "Source-linked guidance. Uncertainty made clear."}
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div className="user-message" key={m.id}>
                        <span className="eyebrow">
                          {i18n.language === "hi" ? "आप" : "YOU"}
                        </span>
                        <p>{m.content}</p>
                      </div>
                    ) : (
                      <Answer
                        key={m.id}
                        message={m}
                        onSource={setSource}
                        pending={mutation.isPending}
                        onChoose={
                          m.id === messages.at(-1)?.id
                            ? (value) => {
                                setNotice("");
                                setText(value);
                                mutation.mutate(value);
                              }
                            : undefined
                        }
                        onCustom={() => composer.current?.focus()}
                      />
                    ),
                  )}
                </div>
              )}
              {mutation.isPending && (
                <ResearchProgress events={progress} demo={temporary || demoMode} />
              )}
              <div ref={end} />
            </div>
            <div className="composer-area">
              {notice && (
                <Alert severity="info" onClose={() => setNotice("")}>
                  {notice}
                </Alert>
              )}
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim() && !mutation.isPending) {
                    setNotice("");
                    mutation.mutate(text.trim());
                  }
                }}
              >
                <textarea
                  disabled={mutation.isPending}
                  ref={composer}
                  aria-label={t("ask")}
                  placeholder={t("ask")}
                  value={text}
                  maxLength={8000}
                  rows={1}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form.requestSubmit();
                    }
                  }}
                />
                <div className="composer-bottom">
                  <div className="row">
                    <VoiceInput
                      disabled={mutation.isPending}
                      onTranscript={(value) => {
                        setText(value);
                        composer.current?.focus();
                      }}
                    />
                    <Button
                      type="submit"
                      variant="contained"
                      aria-label={t("send")}
                      disabled={!text.trim() || mutation.isPending}
                    >
                      <ArrowUp size={18} />
                    </Button>
                  </div>
                </div>
              </form>
              <p className="composer-disclaimer">{t("disclaimer")}</p>
            </div>
          </main>
          <div className={`desktop-context ${rightPanelOpen ? "" : "is-collapsed"}`}>
            <ContextPanel
              context={{ ...current?.facts, ...current?.assessments[scope] }}
              scope={scope}
              onScopeChange={setScope}
              disabled={mutation.isPending}
            />
          </div>
        </div>
      </div>
      <Drawer
        anchor="right"
        open={contextOpen}
        onClose={() => setContextOpen(false)}
      >
        <ContextPanel
          context={{ ...current?.facts, ...current?.assessments[scope] }}
          scope={scope}
          onScopeChange={setScope}
          disabled={mutation.isPending}
          onClose={() => setContextOpen(false)}
        />
      </Drawer>
      <SourceDrawer source={source} onClose={() => setSource(null)} />
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t(edit === "delete" ? "delete" : "rename")}</DialogTitle>
        <DialogContent>
          {edit === "delete" ? (
            <p>{t("deleteConfirm")}</p>
          ) : (
            <TextField
              autoFocus
              label={t("rename")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              margin="dense"
              inputProps={{ maxLength: 100 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>{t("cancel")}</Button>
          <Button
            variant="contained"
            color={edit === "delete" ? "error" : "primary"}
            disabled={edit === "rename" && !title.trim()}
            onClick={editConsultation}
          >
            {t(edit === "delete" ? "delete" : "save")}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

