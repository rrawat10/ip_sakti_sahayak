import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@mui/material";
import {
  ArrowRight,
  ArrowUpRight,
  Scale,
  FlaskConical,
  Sprout,
  Globe2,
  BookOpen,
  Fingerprint,
  Check,
  FileText,
  Pause,
  Play,
  Circle,
} from "lucide-react";
import Benchmarks from "./Benchmarks";
import sourceCatalog from "../../../corpus/catalog.json";
import { SourceDrawer } from "../components/Common";

function ProductPreview({ hi }) {
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState(0);
  const [source, setSource] = useState(null);
  const steps = hi
    ? ["तथ्य स्पष्ट करें", "स्रोत देखें", "आधार जाँचें"]
    : ["Clarify the facts", "Inspect the sources", "Review the evidence"];
  const patentSource = sourceCatalog.find((item) => item.id === "patents");
  return (
    <div
      className="product-tour"
      id="product-preview"
      aria-label={
        hi ? "इंटरैक्टिव उत्पाद पूर्वावलोकन" : "Interactive product preview"
      }
    >
      <div className="tour-top">
        <BookOpen size={18} aria-hidden="true" />
        <span>IP-SAKTI / {hi ? "शोध कार्यक्षेत्र" : "Research workspace"}</span>
        <span className="mode-label">
          {hi ? "इंटरैक्टिव पूर्वावलोकन" : "Interactive preview"}
        </span>
      </div>
      <div className="tour-layout">
        <div className="tour-navigation">
          <span className="eyebrow">
            {hi ? "प्रश्न से अगले कदम तक" : "A CLEARER WAY FORWARD"}
          </span>
          <h3>
            {hi ? "आपका शोध, संदर्भ सहित।" : "Your research, with context."}
          </h3>
          <div
            className="tour-step-buttons"
            aria-label={hi ? "पूर्वावलोकन चरण" : "Preview steps"}
          >
            {steps.map((label, index) => (
              <button
                key={label}
                aria-pressed={step === index}
                aria-controls="tour-panel"
                onClick={() => setStep(index)}
              >
                <span>0{index + 1}</span>
                {label}
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
          <p>
            {hi
              ? "उदाहरण देखने के लिए चरण चुनें। लाइव AI अनुरोध नहीं किया जाता।"
              : "Choose a step to explore the experience. No live AI request is made."}
          </p>
        </div>
        <div className="tour-panel" id="tour-panel">
          <div className="tour-question">
            <span>{hi ? "उदाहरण प्रश्न" : "EXAMPLE QUESTION"}</span>
            <p>
              {hi
                ? "मेरी आयुर्वेदिक औषधि के लिए कौन सा IP विकल्प उचित है?"
                : "Which IP pathway fits my Ayurvedic formulation?"}
            </p>
          </div>
          <div className="tour-answer" key={step}>
            <div className="tour-answer-byline">
              <span className="research-icon">
                <BookOpen size={17} />
              </span>
              <strong>IP-SAKTI Sahayak</strong>
              <span className="scope-pill">{hi ? "भारत" : "India"}</span>
            </div>
            {step === 0 ? (
              <>
                <h3>
                  {hi
                    ? "पहले, अपने उत्पाद के बारे में बताइए।"
                    : "First, tell us about your product."}
                </h3>
                <p>
                  {hi
                    ? "आप इसका उपयोग किस रूप में करना चाहते हैं?"
                    : "How do you intend to use it?"}
                </p>
                <div className="tour-choices">
                  {(hi
                    ? ["औषधि", "खाद्य", "पूरक", "प्रसाधन"]
                    : ["Medicine", "Food", "Supplement", "Cosmetic"]
                  ).map((label, index) => (
                    <button
                      key={label}
                      aria-pressed={choice === index}
                      onClick={() => setChoice(index)}
                    >
                      <span>{String.fromCharCode(65 + index)}</span>
                      {label}
                      {choice === index && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <small>
                  {hi
                    ? "बताए गए उपयोग से शोध शुरू होता है; इससे कानूनी वर्गीकरण तय नहीं होता।"
                    : "Your intended use guides the research; it does not establish a legal classification."}
                </small>
              </>
            ) : step === 1 ? (
              <>
                <h3>
                  {hi
                    ? "मूल स्रोत। एक क्लिक की दूरी पर।"
                    : "The original source. One click away."}
                </h3>
                <p>
                  {hi
                    ? "प्रावधान और प्रकाशक को सीधे देखें। स्रोत पहचान को दावे के समर्थन से अलग जाँचा जाता है।"
                    : "Inspect the provision and its publisher directly. Source identity and claim support are checked separately."}
                </p>
                <button
                  className="tour-source"
                  onClick={() => setSource(patentSource)}
                >
                  <FileText size={25} />
                  <span>
                    <strong>{patentSource.title}</strong>
                    <small>
                      {patentSource.authority} · {patentSource.locator}
                    </small>
                  </span>
                  <ArrowUpRight size={18} />
                </button>
                <small>
                  {hi
                    ? "संदर्भ निर्देशिका का उदाहरण; लाइव खोज नहीं।"
                    : "An example from the reference directory; not a live search."}
                </small>
              </>
            ) : (
              <>
                <h3>
                  {hi
                    ? "विश्वास के साथ उसका आधार भी।"
                    : "Confidence, with its reasons."}
                </h3>
                <p>
                  {hi
                    ? "उत्तर के साथ स्रोत समर्थन, कमियाँ और अनिश्चितता देखें।"
                    : "See the supporting evidence, missing facts, and uncertainty alongside the answer."}
                </p>
                <div className="tour-checks">
                  {(hi
                    ? [
                        "उद्धरण की पहचान",
                        "दावे का साक्ष्य",
                        "अधिकार क्षेत्र और तारीख",
                        "अनिश्चितता और विरोध",
                      ]
                    : [
                        "Citation identity",
                        "Claim support",
                        "Jurisdiction and dates",
                        "Uncertainty and conflicts",
                      ]
                  ).map((label) => (
                    <span key={label}>
                      <Circle size={14} />
                      {label}
                    </span>
                  ))}
                </div>
                <small>
                  {hi
                    ? "जाँच का पूर्वावलोकन • इस उदाहरण पर कोई जाँच नहीं चली"
                    : "Review preview · these checks have not run on this example"}
                </small>
              </>
            )}
          </div>
          <div className="tour-panel-footer">
            <span>
              {hi ? "उदाहरण डेटा" : "Example data"} ·{" "}
              {hi
                ? "पेशेवर समीक्षा का विकल्प नहीं"
                : "Professional review remains important"}
            </span>
            <button onClick={() => setStep((step + 1) % steps.length)}>
              {hi ? "अगला चरण" : "Next step"}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
export function Home() {
  const { t, i18n } = useTranslation();
  const hi = i18n.language === "hi";
  const [audiencePaused, setAudiencePaused] = useState(false);
  const audience = hi
    ? ["आयुर्वेद चिकित्सक", "शोधकर्ता", "AYUSH स्टार्टअप", "MSME और कृषक"]
    : [
        "Ayurveda practitioners",
        "Researchers",
        "AYUSH startups",
        "MSMEs & cultivators",
      ];
  const areas = [
    [
      "patents",
      Scale,
      "Protect your innovation",
      "अपने नवाचार की रक्षा करें",
      "Patents, trademarks, GI, designs, and more.",
      "पेटेंट, ट्रेडमार्क, GI, डिजाइन और अन्य अधिकार।",
    ],
    [
      "classification",
      FlaskConical,
      "Know your product category",
      "अपने उत्पाद की श्रेणी समझें",
      "Find the questions that shape your regulatory pathway.",
      "नियामक दिशा तय करने वाले प्रश्न पहचानें।",
    ],
    [
      "abs",
      Sprout,
      "Understand biological resources",
      "जैविक संसाधन समझें",
      "Explore access, benefit sharing, and traditional knowledge.",
      "पहुँच, लाभ-साझाकरण और पारंपरिक ज्ञान समझें।",
    ],
    [
      "exports",
      Globe2,
      "Explore international pathways",
      "अंतरराष्ट्रीय विकल्प खोजें",
      "Treaties and market access, with clear boundaries.",
      "स्पष्ट अधिकार क्षेत्रों के साथ संधियाँ और बाज़ार प्रवेश।",
    ],
  ];
  return (
    <>
      <main className="landing-page">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="status-dot" />
              {hi
                ? "आयुर्वेद के लिए IP और नियामक मार्गदर्शन"
                : "Ayurveda IP & regulatory research"}
            </span>
            <h1>
              {hi ? (
                <>
                  आयुर्वेद पर आपका शोध,
                  <br />
                  <em>मूल स्रोतों के साथ।</em>
                </>
              ) : (
                <>
                  Your Ayurveda research,
                  <br />
                  <em>backed by original sources.</em>
                </>
              )}
            </h1>
            <p>
              {hi
                ? "बौद्धिक संपदा, उत्पाद वर्गीकरण और नियमों को समझें। स्रोत देखें, तथ्यों को स्पष्ट करें और अपना अगला कदम तय करें।"
                : "Understand intellectual property, product classification, and regulations. Follow the sources, clarify the facts, and plan your next step."}
            </p>
            <div className="hero-actions">
              <Button
                variant="contained"
                size="large"
                component={Link}
                to="/sign-up"
                endIcon={<ArrowRight size={18} />}
              >
                {t("start")}
              </Button>
              
            </div>
            <div className="hero-assurances">
              <span>
                <Check size={15} />
                {hi ? "प्रामाणिक स्रोत" : "Authoritative sources"}
              </span>
              <span>
                <Check size={15} />
                {hi ? "स्पष्ट अधिकार क्षेत्र" : "Clear jurisdictions"}
              </span>
              <span>
                <Check size={15} />
                {hi ? "English और हिंदी" : "English & Hindi"}
              </span>
            </div>
          </div>
          <ProductPreview hi={hi} />
        </section>
        <div className={`audience-line ${audiencePaused ? "is-paused" : ""}`}>
          <span>{hi ? "इनके लिए निर्मित" : "BUILT FOR"}</span>
          <div className="audience-window">
            <div className="audience-track">
              {[0, 1].map((copy) => (
                <div
                  className="audience-group"
                  key={copy}
                  aria-hidden={copy === 1 ? true : undefined}
                >
                  {audience.map((label) => (
                    <span key={label}>
                      <Sprout size={17} strokeWidth={1.5} />
                      {label}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <button
            className="audience-pause"
            aria-label={
              hi ? "दर्शक पट्टी का एनीमेशन रोकें" : "Pause audience animation"
            }
            aria-pressed={audiencePaused}
            onClick={() => setAudiencePaused(!audiencePaused)}
          >
            {audiencePaused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>
        <section className="home-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {hi ? "अपने प्रश्न से शुरू करें" : "START WITH YOUR QUESTION"}
              </span>
              <h2>
                {hi
                  ? "जुड़ा हुआ विषय। एक स्पष्ट शुरुआत।"
                  : "What would you like to research?"}
              </h2>
            </div>
            <Link className="text-link" to="/library">
              {t("learn")}
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="area-grid">
            {areas.map(([topic, Icon, en, hindi, desc, descHi]) => (
              <Link
                to={`/library?topic=${topic}`}
                className="area-card"
                key={topic}
              >
                <Icon size={27} strokeWidth={1.4} />
                <h3>{hi ? hindi : en}</h3>
                <p>{hi ? descHi : desc}</p>
                <ArrowUpRight size={18} />
              </Link>
            ))}
          </div>
        </section>
        <Benchmarks hi={hi} />
        <section className="trust-section">
          <Fingerprint size={40} strokeWidth={1} />
          <div>
            <span className="eyebrow">
              {hi ? "साक्ष्य, हर कदम पर" : "EVIDENCE AT EVERY STEP"}
            </span>
            <h2>
              {hi
                ? "सिर्फ उत्तर नहीं। उसका आधार भी।"
                : "An answer you can trace back to its source."}
            </h2>
            <p>
              {hi
                ? "प्रावधान, प्राधिकरण और समीक्षा तिथि देखें। अनिश्चितता दिखाई जाती है और विशेषज्ञ सलाह का रास्ता खुला रहता है।"
                : "Inspect the provision, the authority, and the review date. Uncertainty stays visible, and expert advice stays within reach."}
            </p>
          </div>
          <Button
            variant="outlined"
            component={Link}
            to="/library"
            endIcon={<ArrowRight size={17} />}
          >
            {t("sourceLibrary")}
          </Button>
        </section>
      </main>
    </>
  );
}
export function About() {
  const { t, i18n } = useTranslation();
  const hi = i18n.language === "hi";
  return (
    <main className="public-main about-page">
      <span className="eyebrow">{t("about")}</span>
      <h1>
        {hi
          ? "आयुर्वेद के लिए एक विचारपूर्ण शोध सहयोगी।"
          : "A thoughtful research companion for Ayurveda."}
      </h1>
      <p className="lead">
        {hi
          ? "IP-SAKTI Sahayak SIH26045 के लिए बनाया गया एक स्वतंत्र हैकाथॉन प्रोटोटाइप है। यह सरकारी सेवा या आधिकारिक कानूनी सलाह नहीं है।"
          : "IP-SAKTI Sahayak is an independent hackathon prototype for SIH26045. It is not an official government service or a legal advisory service."}
      </p>
      <section>
        <h2>{hi ? "हम कैसे मदद करते हैं" : "How the workspace helps"}</h2>
        <p>
          {hi
            ? "हम उत्पाद के तथ्य, अधिकार क्षेत्र और स्रोतों को एक साथ रखकर शोध व्यवस्थित करते हैं। अनिश्चित मामलों में उत्तर रोकते हैं और आवश्यक जानकारी बताते हैं।"
            : "We organize product facts, jurisdictions, and source evidence in one workspace. Uncertain questions lead to clarification or abstention, with the missing evidence made explicit."}
        </p>
      </section>
      <section>
        <h2>{t("privacy")}</h2>
        <p>
          {hi
            ? "डेमो में परामर्श इस ब्राउज़र टैब के सत्र में रखे जाते हैं। पासवर्ड नहीं सहेजे जाते। भाषा और थीम इस ब्राउज़र में याद रखे जाते हैं। वास्तविक सेवा में आपके प्रश्न बाहरी AI सेवाओं द्वारा संसाधित हो सकते हैं; गोपनीय जानकारी साझा करने से पहले इसकी समीक्षा करें।"
            : "In demo mode, consultations stay in this browser tab’s session. Passwords are not saved. Theme and language preferences are remembered in this browser. In live mode, questions may be processed by external AI services; review what you share before including confidential information."}
        </p>
        <p>
          {hi
            ? "लाइव सेवा में परामर्श MongoDB में सहेजे जाते हैं और प्रश्न व चुने गए स्रोत Gemini को भेजे जाते हैं। वॉइस चालू होने पर ऑडियो Bhashini को भेजा जाता है। वैकल्पिक LangSmith निदान में सामग्री डिफ़ॉल्ट रूप से छिपी रहती है। सेटिंग्स से अपना डेटा निर्यात या खाता हटाएँ। निदान रिकॉर्ड 30 दिन और सुरक्षा/अनुमति रिकॉर्ड 90 दिन तक रखे जाते हैं।"
            : "Live consultations are saved in MongoDB. Questions and selected source excerpts are sent to Gemini. Voice features send audio to Bhashini. Optional LangSmith diagnostics hide content by default. Export your data or delete your account in Settings. Diagnostic records are retained for 30 days and security/permission records for 90 days."}
        </p>
        <p>{t("disclaimer")}</p>
      </section>
      <section>
        <h2>{t("support")}</h2>
        <p>{t("supportSub")}</p>
        <Button
          component="a"
          href="https://ipindia.gov.in/"
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<ArrowUpRight size={16} />}
        >
          {hi
            ? "IP India आधिकारिक संपर्क और संसाधन"
            : "IP India official contacts and resources"}
        </Button>
      </section>
    </main>
  );
}
