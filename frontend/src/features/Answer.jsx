import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@mui/material";
import {
  BookOpen,
  Copy,
  ThumbsUp,
  ThumbsDown,
  ArrowUpRight,
  Check,
  ShieldCheck,
} from "lucide-react";
import { IconAction } from "../components/Common";
import { post } from "../services/api";
import { ReadAloud } from "./Speech";
import { ClarificationCard, EvidenceReview } from "./ResearchCards";
export default function Answer({
  message,
  onSource,
  onChoose,
  onCustom,
  pending,
  temporary = false,
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState("");
  const a = message.answer;
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        [
          a.title,
          a.short_answer,
          ...a.sections.map((s) => `${s.heading}\n${s.text}`),
          ...a.citations.map((s) => `${s.title} — ${s.locator}\n${s.url}`),
          a.disclaimer,
        ].join("\n\n"),
      );
      setCopied(true);
    } catch {
      setError("Copy unavailable. Select the text to copy it.");
    }
  }
  async function rate(value) {
    try {
      await post("/feedback", { message_id: message.id, rating: value });
      setFeedback(value);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <article className="answer" aria-label={t("answer")}>
      <div className="answer-byline">
        <span className="answer-avatar">
          <BookOpen size={18} />
        </span>
        <strong>IP-SAKTI Sahayak</strong>
        <span className="scope-pill">{t(a.scope)}</span>
      </div>
      <div className="answer-content">
        <div className="row between">
          <span className={`evidence-tag ${a.confidence.toLowerCase()}`}>
            <ShieldCheck size={13} />
            {t(a.confidence.toLowerCase())} · {t("evidence")}
          </span>
          <span className="muted small">
            {a.status === "needs_clarification"
              ? t("needsClarification")
              : a.status === "abstained"
                ? t("insufficient")
                : ""}
          </span>
        </div>
        <h2>{a.title}</h2>
        <p className="answer-summary">{a.short_answer}</p>
        {a.status === "needs_clarification" &&
          a.clarification_options?.length > 0 && (
            <ClarificationCard
              options={a.clarification_options}
              onChoose={onChoose}
              onCustom={onCustom}
              disabled={pending || !onChoose}
            />
          )}
        {a.sections.map((s, i) => (
          <section key={i}>
            <h3>{s.heading}</h3>
            <p>
              {s.text}{" "}
              {s.citation_ids.map((id) => {
                const source = a.citations.find((x) => x.id === id);
                return (
                  source && (
                    <a
                      className="inline-citation"
                      key={id}
                      href={
                        /^https?:\/\//i.test(source.url || "")
                          ? source.url
                          : undefined
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${t("sourceTitle")}: ${source.title}`}
                    >
                      {source.title} · {source.locator}
                    </a>
                  )
                );
              })}
            </p>
          </section>
        ))}
        {a.missing_facts.length > 0 && (
          <div className="clarification-box">
            <h4>{t("missing")}</h4>
            <ul>
              {a.missing_facts.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {a.next_steps.length > 0 && (
          <section>
            <h3>{t("nextSteps")}</h3>
            <ol>
              {a.next_steps.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </section>
        )}
        {a.citations.length > 0 && (
          <section className="answer-sources">
            <h4>{t("sourceCount")}</h4>
            {a.citations.map((s, i) => (
              <button
                className="answer-source"
                key={s.id}
                onClick={() => onSource(s)}
              >
                <span className="citation-index">{i + 1}</span>
                <span>
                  <strong>{s.title}</strong>
                  <small>
                    {s.authority} · {s.locator}
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </section>
        )}
        {a.status === "needs_clarification" ? (
          <p className="confidence-note">{a.confidence_reasons.join(" ")}</p>
        ) : (
          <EvidenceReview answer={a} />
        )}
        <div className="answer-actions">
          {!temporary && <ReadAloud
            text={[a.short_answer, ...a.sections.map((s) => s.text)].join("\n")}
            language={a.language}
          />}
          <IconAction label={copied ? t("copied") : t("copy")} onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </IconAction>
          {!temporary && <><span className="action-divider" />
          <IconAction
            label={t("helpful")}
            onClick={() => rate(1)}
            color={feedback === 1 ? "primary" : "default"}
          >
            <ThumbsUp size={16} />
          </IconAction>
          <IconAction
            label={t("unhelpful")}
            onClick={() => rate(-1)}
            color={feedback === -1 ? "primary" : "default"}
          >
            <ThumbsDown size={16} />
          </IconAction>
          {feedback && (
            <span className="small muted">{t("feedbackThanks")}</span>
          )}
          </>}
        </div>
        {error && <Alert severity="error">{error}</Alert>}
      </div>
    </article>
  );
}
