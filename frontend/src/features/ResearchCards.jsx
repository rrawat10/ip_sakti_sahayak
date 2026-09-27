import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@mui/material";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";

const stages = {
  analyze: ["Understanding your question", "आपका प्रश्न समझ रहे हैं"],
  retrieve: ["Retrieving reviewed sources", "समीक्षित स्रोत खोज रहे हैं"],
  rewrite: ["Refining the source search", "स्रोत खोज सुधार रहे हैं"],
  generate: [
    "Preparing a sourced answer",
    "स्रोतों सहित उत्तर तैयार कर रहे हैं",
  ],
  validate: ["Checking claims and citations", "दावे और उद्धरण जाँच रहे हैं"],
};

export function recordProgress(previous, event) {
  if (!stages[event.stage] || !["running", "complete"].includes(event.status))
    return previous;
  if (event.status === "running") return [...previous, event];
  const index = previous.findLastIndex(
    (item) => item.stage === event.stage && item.status === "running",
  );
  return index < 0
    ? previous
    : previous.map((item, i) => (i === index ? { ...item, ...event } : item));
}

export function ResearchProgress({ events, demo }) {
  const { i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const latest = events.at(-1);
  const label = demo
    ? hi
      ? "डेमो उदाहरण तैयार हो रहा है"
      : "Preparing a demo example"
    : latest
      ? stages[latest.stage][hi ? 1 : 0]
      : hi
        ? "शोध अनुरोध शुरू हो रहा है"
        : "Starting your research request";
  return (
    <div className="research-progress">
      <div className="research-card-heading">
        <span className="research-icon">
          <LoaderCircle size={18} className="working-spinner" />
        </span>
        <div>
          <span className="eyebrow">
            {demo
              ? hi
                ? "डेमो पूर्वावलोकन"
                : "DEMO PREVIEW"
              : hi
                ? "शोध जारी है"
                : "RESEARCH IN PROGRESS"}
          </span>
          <p role="status" aria-live="polite">
            {label}
          </p>
        </div>
        <span className="progress-live">
          <span className="status-dot" />
          {demo ? "Demo" : "Live"}
        </span>
      </div>
      {!demo && events.length > 0 && (
        <ol
          className="research-timeline"
          aria-label={hi ? "शोध के चरण" : "Research steps"}
        >
          {events.map((event, index) => (
            <li
              key={index}
              className={event.status}
              aria-current={event.status === "running" ? "step" : undefined}
            >
              {event.status === "complete" ? (
                <Check size={15} />
              ) : (
                <Circle size={15} />
              )}
              <span>{stages[event.stage][hi ? 1 : 0]}</span>
              {Number.isFinite(event.elapsed_ms) && (
                <small>{(event.elapsed_ms / 1000).toFixed(1)} s</small>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="research-card-footnote">
        {demo
          ? hi
            ? "उदाहरण उत्तर • कोई लाइव AI अनुरोध नहीं"
            : "Scripted response · no live AI request"
          : hi
            ? "स्रोतों और दावों की जाँच के बाद उत्तर दिखाई देगा।"
            : "Your answer appears after the evidence checks finish."}
      </p>
    </div>
  );
}

export function ClarificationCard({ options, onChoose, onCustom, disabled }) {
  const { i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const [selected, setSelected] = useState("");
  const name = useId();
  return (
    <div className="clarification-card">
      <fieldset disabled={disabled}>
        <legend>
          {hi ? "सबसे उपयुक्त विकल्प चुनें" : "Choose the closest fit"}
        </legend>
        <p className="small muted">
          {hi
            ? "यह आपके बताए उपयोग की जानकारी है, कानूनी वर्गीकरण नहीं।"
            : "This records your intended facts; it does not determine a legal category."}
        </p>
        <div className="clarification-options">
          {options.map((option, index) => (
            <label
              className={`clarification-option ${selected === option ? "selected" : ""}`}
              key={option}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected === option}
                onChange={() => setSelected(option)}
              />
              <span className="option-letter" aria-hidden="true">
                {String.fromCharCode(65 + index)}
              </span>
              <span>{option}</span>
              {selected === option && <Check size={16} aria-hidden="true" />}
            </label>
          ))}
        </div>
        <div className="clarification-actions">
          <Button
            variant="contained"
            disabled={!selected || disabled}
            onClick={() => onChoose(selected)}
            endIcon={<ArrowRight size={16} />}
          >
            {hi ? "जारी रखें" : "Continue"}
          </Button>
          <Button disabled={disabled} onClick={onCustom}>
            {hi ? "अपने शब्दों में लिखें" : "Write my own answer"}
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

const checkLabels = {
  citation_integrity: [
    "Citation identifiers resolve",
    "उद्धरण पहचान उपलब्ध हैं",
  ],
  section_support: [
    "Statements supported by cited text",
    "उद्धृत पाठ दावों का समर्थन करता है",
  ],
  scope: ["Jurisdiction matches", "अधिकार क्षेत्र मेल खाता है"],
  temporal: [
    "Legal status and dates considered",
    "कानूनी स्थिति और तिथियाँ जाँची गईं",
  ],
  uncertainty: [
    "Missing facts and uncertainty acknowledged",
    "अनुपलब्ध तथ्य और अनिश्चितता स्पष्ट हैं",
  ],
  conflicts: [
    "Conflicting evidence addressed",
    "विरोधी साक्ष्यों पर विचार किया गया",
  ],
};

export function EvidenceReview({ answer }) {
  const { i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const review = answer.evidence_review;
  const automated = review?.kind === "automated";
  const entries = automated
    ? Object.keys(checkLabels).map((key) => [
        key,
        review.checks?.[key] === true,
      ])
    : [];
  const passed = entries.filter(([, value]) => value).length;
  return (
    <details className="evidence-review">
      <summary>
        <span className="research-icon">
          <ShieldCheck size={18} />
        </span>
        <span>
          <strong>
            {hi ? "उत्तर की साक्ष्य जाँच" : "Answer evidence review"}
          </strong>
          <small>
            {automated
              ? hi
                ? `${passed}/${entries.length} स्वचालित जाँच सफल`
                : `${passed}/${entries.length} automated checks passed`
              : review?.kind === "demo"
                ? hi
                  ? "डेमो • लाइव जाँच नहीं हुई"
                  : "Demo · live checks not performed"
                : hi
                  ? "स्वचालित स्वीकृति उपलब्ध नहीं"
                  : "No automated approval available"}
          </small>
        </span>
        <ChevronDown size={16} className="review-chevron" />
      </summary>
      <div className="evidence-review-body">
        {entries.length > 0 && (
          <ul>
            {entries.map(([key, value]) => (
              <li key={key}>
                {value ? <Check size={15} /> : <Circle size={15} />}
                <span>{checkLabels[key][hi ? 1 : 0]}</span>
                <small>
                  {value
                    ? hi
                      ? "सफल"
                      : "Passed"
                    : hi
                      ? "पुष्टि नहीं हुई"
                      : "Not confirmed"}
                </small>
              </li>
            ))}
          </ul>
        )}
        <p>{answer.confidence_reasons.join(" ")}</p>
        {automated && (
          <p>
            {hi
              ? `${review.sections_checked}/${review.total_sections} भागों का समर्थन पुष्ट हुआ।`
              : `${review.sections_checked}/${review.total_sections} sections have confirmed support.`}{" "}
            {hi
              ? "मॉडल द्वारा जाँच कानूनी शुद्धता की गारंटी नहीं है।"
              : "Model-based checking is not a guarantee of legal correctness."}
          </p>
        )}
        <p className="small muted">
          {hi
            ? "मूल स्रोत देखें और महत्वपूर्ण निर्णयों के लिए विशेषज्ञ समीक्षा लें।"
            : "Inspect the original sources and seek expert review for consequential decisions."}
        </p>
      </div>
    </details>
  );
}
