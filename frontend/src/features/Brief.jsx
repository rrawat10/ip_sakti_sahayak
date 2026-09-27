import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
} from "@mui/material";
import { FileText } from "lucide-react";
import { IconAction } from "../components/Common";
import { demoMode, download } from "../services/api";

export function buildBrief(consultation, facts, messages, demo) {
  const citations = new Map();
  const sections = messages.map((message) => {
    if (message.role === "user")
      return `[${message.scope}] Question\n${message.content}`;
    const answer = message.answer;
    for (const source of answer.citations) citations.set(source.id, source);
    return (
      `[${message.scope}] ${answer.status}\n${answer.title}\n${answer.short_answer}\n` +
      answer.sections
        .map((section) => `${section.heading}\n${section.text}`)
        .join("\n\n")
    );
  });
  return [
    "IP-SAKTI — consultation brief",
    consultation.title,
    demo
      ? "DEMO FIXTURES — not live research"
      : "Informational research — professional review required",
    "Selected user-supplied facts",
    ...Object.entries(facts).map(
      ([key, value]) =>
        `${key}: ${Array.isArray(value) ? value.join(", ") : value}`,
    ),
    "Selected conversation",
    ...sections,
    "Supporting sources",
    ...[...citations.values()].map(
      (source) =>
        `${source.title}\n${source.locator}\n${source.url}\nVersion: ${source.version_id || "Directory reference"}`,
    ),
    "Prepared locally. No information has been sent to an expert or external recipient.",
  ].join("\n\n");
}

export default function Brief({ consultation }) {
  const { t, i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const toggle = (setter, value) =>
    setter((selected) =>
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  return (
    <>
      <IconAction
        label={hi ? "विशेषज्ञ के लिए सारांश" : "Prepare expert brief"}
        disabled={!consultation}
        onClick={() => {
          setFacts([]);
          setMessages([]);
          setOpen(true);
        }}
      >
        <FileText size={16} />
      </IconAction>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {hi ? "साझा करने के लिए जानकारी चुनें" : "Choose what to include"}
        </DialogTitle>
        <DialogContent>
          <p>
            {hi
              ? "डाउनलोड स्थानीय है। विशेषज्ञ को कुछ भी अपने आप नहीं भेजा जाएगा।"
              : "Download a local brief. Nothing is sent to an expert automatically."}
          </p>
          {Object.entries(consultation?.facts || {})
            .filter(([, value]) => value?.length)
            .map(([key, value]) => (
              <FormControlLabel
                key={key}
                sx={{ display: "flex" }}
                control={
                  <Checkbox
                    checked={facts.includes(key)}
                    onChange={() => toggle(setFacts, key)}
                  />
                }
                label={`${key}: ${Array.isArray(value) ? value.join(", ") : value}`}
              />
            ))}
          {(consultation?.messages || []).map((message) => (
            <FormControlLabel
              key={message.id}
              sx={{ display: "flex" }}
              control={
                <Checkbox
                  checked={messages.includes(message.id)}
                  onChange={() => toggle(setMessages, message.id)}
                />
              }
              label={`[${t(message.scope)}] ${message.content || message.answer.title}`}
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button
            variant="contained"
            disabled={!facts.length && !messages.length}
            onClick={() => {
              download(
                "ip-sakti-expert-brief.txt",
                buildBrief(
                  consultation,
                  Object.fromEntries(
                    Object.entries(consultation.facts || {}).filter(([key]) =>
                      facts.includes(key),
                    ),
                  ),
                  consultation.messages.filter((message) =>
                    messages.includes(message.id),
                  ),
                  demoMode,
                ),
              );
              setOpen(false);
            }}
          >
            {hi ? "सारांश डाउनलोड करें" : "Download brief"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
