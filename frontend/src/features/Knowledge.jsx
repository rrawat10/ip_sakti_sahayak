import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TextField, MenuItem } from "@mui/material";
import {
  ArrowUpRight,
  Search,
  BookOpen,
} from "lucide-react";
import { api } from "../services/api";
import { ErrorNotice, Loading, SourceDrawer } from "../components/Common";
export const topicGroups = [
  {
    en: "Intellectual property",
    hi: "बौद्धिक संपदा",
    items: [
      ["patents", "Patents", "पेटेंट"],
      ["trademarks", "Trademarks", "ट्रेडमार्क"],
      ["gi", "Geographical indications", "भौगोलिक संकेत"],
      ["copyright", "Copyright", "कॉपीराइट"],
      ["designs", "Designs", "डिजाइन"],
      ["plant-varieties", "Plant variety protection", "पौध किस्म संरक्षण"],
      ["trade-secrets", "Trade secrets", "व्यापार रहस्य"],
      ["traditional-knowledge", "Traditional knowledge", "पारंपरिक ज्ञान"],
    ],
  },
  {
    en: "Product & regulation",
    hi: "उत्पाद और विनियमन",
    items: [
      [
        "classification",
        "Classical & proprietary medicines",
        "शास्त्रीय और स्वामित्व औषधियाँ",
      ],
      [
        "regulation",
        "New drugs & phytopharmaceuticals",
        "नई औषधियाँ और फाइटोफार्मास्यूटिकल",
      ],
      [
        "food",
        "Ayurveda-Aahar & nutraceuticals",
        "आयुर्वेद-आहार और न्यूट्रास्यूटिकल",
      ],
      ["cosmetics", "Cosmetics", "प्रसाधन"],
      ["advertising", "Advertising", "विज्ञापन"],
      ["labelling", "Labelling", "लेबलिंग"],
      ["abs", "Biological resources & ABS", "जैविक संसाधन और ABS"],
    ],
  },
  {
    en: "International frameworks",
    hi: "अंतरराष्ट्रीय ढाँचे",
    items: [
      ["trips", "TRIPS", "TRIPS"],
      ["cbd", "Convention on Biological Diversity", "जैव विविधता सम्मेलन"],
      ["nagoya", "Nagoya Protocol", "नागोया प्रोटोकॉल"],
      ["gratk", "WIPO GRATK Treaty", "WIPO GRATK संधि"],
      ["pct", "Patent Cooperation Treaty", "पेटेंट सहयोग संधि"],
      ["madrid", "Madrid System", "मैड्रिड प्रणाली"],
      ["hague", "Hague System", "हेग प्रणाली"],
      ["budapest", "Budapest Treaty", "बुडापेस्ट संधि"],
      ["exports", "US, EU & UK market access", "US, EU और UK बाज़ार प्रवेश"],
    ],
  },
];
export function Knowledge() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const topic = params.get("topic") || "all";
  const item = topicGroups.flatMap((group) => group.items).find(([id]) => id === topic);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [source, setSource] = useState(null);
  const query = useQuery({
    queryKey: ["sources"],
    queryFn: () => api("/sources"),
  });
  const filtered = query.data?.filter(
    (s) =>
      (topic === "all" || s.topics.includes(topic)) &&
      (scope === "all" || s.scope === scope) &&
      `${s.title} ${s.authority} ${s.summary_hi} ${s.topics.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <main className="public-main">
      <div className="page-intro">
        <span className="eyebrow">{t("sourceLibrary")}</span>
        <h1>{t("library")}</h1>
        <p>{t("learnSub")}</p>
      </div>
      <div className="knowledge-layout">
        <aside className="topic-nav" aria-label={t("knowledge")}>
          <button className={topic === "all" ? "selected" : ""} onClick={() => setParams({})}>{t("all")}</button>
          {topicGroups.map((group) => <section key={group.en}>
            <h3>{i18n.language === "hi" ? group.hi : group.en}</h3>
            {group.items.map(([id, en, hi]) => <button key={id} className={topic === id ? "selected" : ""} onClick={() => setParams({ topic: id })}>
              {i18n.language === "hi" ? hi : en}<ArrowUpRight size={13} />
            </button>)}
          </section>)}
        </aside>
        <section className="library-results">
          <h2>{item ? item[i18n.language === "hi" ? 2 : 1] : t("sourceLibrary")}</h2>
          <p className="muted small">{t("directoryNotice")}</p>
      <div className="filter-bar">
        <TextField
          label={t("searchSources")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: <Search size={17} style={{ marginRight: 10 }} />,
          }}
        />
        <TextField
          select
          label={t("filter")}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          {["all", "india", "international", "us", "eu", "uk"].map((x) => (
            <MenuItem key={x} value={x}>
              {t(x)}
            </MenuItem>
          ))}
        </TextField>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} retry={query.refetch} />
      ) : (
        <div className="directory">
          {filtered.length === 0 && <p>{t("noResults")}</p>}
          {filtered.map((s) => (
            <button
              className="directory-row"
              key={s.id}
              onClick={() => setSource(s)}
            >
              <div className="directory-icon">
                <BookOpen size={23} strokeWidth={1.5} />
              </div>
              <div>
                <div className="row">
                  <span className="eyebrow">{t(s.scope)}</span>
                  <span className="muted small">{s.type}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{i18n.language === "hi" ? s.summary_hi : s.summary}</p>
                <small className="muted">
                  {s.authority} ·{" "}
                  {s.checked_at
                    ? `${t("reviewed")} ${s.checked_at}`
                    : t("notReviewed")}
                </small>
              </div>
              <ArrowUpRight size={20} />
            </button>
          ))}
        </div>
      )}
        </section>
      </div>
      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </main>
  );
}
