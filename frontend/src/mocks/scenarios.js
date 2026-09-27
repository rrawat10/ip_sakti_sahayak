import catalog from "../../../corpus/catalog.json";
export const scopes = ["india", "international", "us", "eu", "uk"];
const ingestedSourceIds = new Set([
  "patents",
  "cdsco",
  "nba",
  "fssai",
  "pct",
  "wipo",
  "fda",
  "ema",
  "mhra",
]);
export const seedSources = catalog.filter((s) => ingestedSourceIds.has(s.id)).map((s) => ({
  ...s,
  version_id: `${s.id}-demo-ingested-20260927`,
}));
export function makeConsultation(title = "New consultation") {
  return {
    id: crypto.randomUUID(),
    title,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [],
    facts: {},
    assessments: {},
  };
}
/** Demo is a small explicit scenario machine, never a substitute for retrieval. */
export function demoAnswer(text, scope, language, previous = {}) {
  const hi = language === "hi";
  const say = (en, hindi) => (hi ? hindi : en);
  const result = {
    schema_version: 1,
    status: "needs_clarification",
    scope,
    language,
    corpus_verified_at: null,
    evidence_review: { kind: "demo" },
    title: say("Let’s establish the relevant facts", "पहले संबंधित तथ्य समझें"),
    short_answer: "",
    sections: [],
    citations: [],
    missing_facts: [],
    next_steps: [],
    confidence: "Insufficient",
    confidence_reasons: [
      say(
        "This is a scripted example, not a live assessment.",
        "यह उदाहरण है, लाइव आकलन नहीं।",
      ),
    ],
    context: { ...previous },
    disclaimer: say(
      "General information, not legal or regulatory advice.",
      "सामान्य जानकारी, कानूनी या नियामक सलाह नहीं।",
    ),
  };
  const cite = (id) => seedSources.find((s) => s.id === id);
  const lower = text.toLowerCase();
  if (previous.pending === "intended_use") {
    result.clarification_options = [
      say("Unchanged classical formulation", "अपरिवर्तित शास्त्रीय औषधि"),
      say(
        "I changed the ingredients or preparation",
        "मैंने सामग्री या तैयारी में बदलाव किया है",
      ),
      say(
        "I do not have a classical reference",
        "मेरे पास शास्त्रीय संदर्भ नहीं है",
      ),
      say("I am not sure yet", "मैं अभी निश्चित नहीं हूँ"),
    ];
    result.context = {
      ...previous,
      intended_use: text,
      pending: "classical_basis",
    };
    result.short_answer = say(
      "Is the formulation and preparation method drawn from a named classical text, or have you changed either?",
      "क्या औषधि और निर्माण विधि किसी नामित शास्त्रीय ग्रंथ से ली गई है, या आपने इनमें बदलाव किया है?",
    );
    result.missing_facts = [
      say("Classical reference and any changes", "शास्त्रीय संदर्भ और बदलाव"),
    ];
  } else if (previous.pending === "classical_basis") {
    result.context = {
      ...previous,
      classical_basis: text,
      pending: null,
      classification: say(
        "Needs source-based review",
        "स्रोत-आधारित समीक्षा आवश्यक",
      ),
    };
    result.status = "abstained";
    result.short_answer = say(
      "Your intended use and formulation background are recorded. A reviewed source and more product detail are needed before proposing a regulatory category.",
      "उपयोग और औषधि का आधार दर्ज है। नियामक श्रेणी बताने से पहले समीक्षित स्रोत और उत्पाद का अधिक विवरण चाहिए।",
    );
    result.next_steps = [
      say(
        "Prepare the ingredient list, processing method, intended claims, and exact classical reference for review.",
        "सामग्री सूची, निर्माण विधि, दावे और सही शास्त्रीय संदर्भ समीक्षा के लिए तैयार करें।",
      ),
    ];
  } else if (
    scope !== "india" &&
    /patent|export|market|herbal|पेटेंट|निर्यात|हर्बल/.test(lower)
  ) {
    const sourceId = { international: "pct", us: "fda", eu: "ema", uk: "mhra" }[
      scope
    ];
    result.status = "answered";
    result.title = say(
      "Begin with the official pathway",
      "आधिकारिक मार्ग से शुरुआत करें",
    );
    result.short_answer = say(
      "The selected official resource is a starting point for this jurisdiction. It does not establish that your product qualifies for a patent, registration, or market access.",
      "चुना हुआ आधिकारिक स्रोत इस अधिकार क्षेत्र के अध्ययन की शुरुआत है। यह उत्पाद की पेटेंट, पंजीकरण या बाज़ार में प्रवेश की पात्रता तय नहीं करता।",
    );
    result.sections = [
      {
        heading: say("Research pointer", "शोध स्रोत"),
        text: hi ? cite(sourceId).summary_hi : cite(sourceId).summary,
        citation_ids: [sourceId],
      },
    ];
    result.citations = [cite(sourceId)];
    result.next_steps = [
      say(
        "Identify the intended product category and claims before seeking market-specific guidance.",
        "बाज़ार-विशिष्ट मार्गदर्शन से पहले उत्पाद की श्रेणी और दावे पहचानें।",
      ),
    ];
  } else if (/patent|पेटेंट/.test(lower)) {
    result.status = "answered";
    result.title = say(
      "Start with what is new in the formulation",
      "औषधि में नया क्या है, इससे शुरू करें",
    );
    result.short_answer = say(
      "Traditional knowledge is an express exclusion to examine under Section 3(p). A formulation’s name or a new combination alone is not enough information to decide patentability.",
      "धारा 3(p) में पारंपरिक ज्ञान से संबंधित अपवाद की जाँच आवश्यक है। केवल नाम या नया संयोजन पेटेंट पात्रता तय करने के लिए पर्याप्त जानकारी नहीं है।",
    );
    result.sections = [
      {
        heading: say("Traditional knowledge", "पारंपरिक ज्ञान"),
        text: say(
          "Section 3(p) addresses inventions that are, in effect, traditional knowledge. The official provision should be read alongside the full patentability requirements.",
          "धारा 3(p) प्रभाव में पारंपरिक ज्ञान होने वाले आविष्कारों से संबंधित है। आधिकारिक प्रावधान को अन्य पेटेंट आवश्यकताओं के साथ पढ़ें।",
        ),
        citation_ids: ["patents"],
      },
    ];
    result.citations = [cite("patents")];
    result.confidence = "Limited";
    result.missing_facts = [
      say(
        "What is new, and what evidence supports it?",
        "क्या नया है और उसके समर्थन में क्या प्रमाण है?",
      ),
    ];
    result.next_steps = [
      say(
        "Describe the difference from known formulations without disclosing confidential details.",
        "गोपनीय जानकारी बताए बिना ज्ञात औषधियों से अंतर स्पष्ट करें।",
      ),
      say(
        "Prepare a prior-art search and discuss it with a patent professional.",
        "पूर्व कला खोज तैयार करें और पेटेंट विशेषज्ञ से चर्चा करें।",
      ),
    ];
    result.context = {
      ...previous,
      product: say("Ayurvedic formulation", "आयुर्वेदिक औषधि"),
      ip: say("Patent · requires assessment", "पेटेंट · आकलन आवश्यक"),
    };
  } else if (/classif|category|वर्गीकरण|श्रेणी/.test(lower)) {
    result.clarification_options = [
      say("For medicinal use", "औषधीय उपयोग के लिए"),
      say("As a food", "खाद्य के रूप में"),
      say("As a supplement", "पूरक के रूप में"),
      say("For cosmetic use", "प्रसाधन उपयोग के लिए"),
    ];
    result.short_answer = say(
      "How will the product be used and described: as a medicine, food, supplement, or cosmetic?",
      "उत्पाद का उपयोग और वर्णन किस रूप में होगा: औषधि, खाद्य, पूरक या प्रसाधन?",
    );
    result.context = { ...previous, pending: "intended_use" };
    result.missing_facts = [
      say("Intended use and product claims", "इच्छित उपयोग और उत्पाद दावे"),
    ];
  } else if (/abs|benefit|biodivers|लाभ|जैव/.test(lower)) {
    result.short_answer = say(
      "Where were the biological resources obtained, and who is proposing to access or use them?",
      "जैविक संसाधन कहाँ से प्राप्त हुए और उनका उपयोग या पहुँच कौन चाहता है?",
    );
    result.context = {
      ...previous,
      abs: say("Needs assessment", "आकलन आवश्यक"),
    };
    result.missing_facts = [
      say(
        "Resource origin, proposed activity, and applicant details",
        "संसाधन का मूल, प्रस्तावित गतिविधि और आवेदक विवरण",
      ),
    ];
    result.next_steps = [
      say(
        "Consult the NBA’s official resources. This demo cannot determine an ABS obligation.",
        "NBA के आधिकारिक स्रोत देखें। यह डेमो ABS दायित्व तय नहीं कर सकता।",
      ),
    ];
  } else if (/traditional|prior.art|tkdl|पारंपरिक|पूर्व कला/.test(lower)) {
    result.status = "answered";
    result.title = say(
      "Use public sources to begin your research",
      "सार्वजनिक स्रोतों से शोध शुरू करें",
    );
    result.short_answer = say(
      "TKDL provides public information, but access to the full database is restricted. We do not search its restricted records.",
      "TKDL सार्वजनिक जानकारी देता है, लेकिन पूरे डेटाबेस की पहुँच सीमित है। हम उसके प्रतिबंधित रिकॉर्ड नहीं खोजते।",
    );
    result.sections = [
      {
        heading: "TKDL",
        text: say(
          "The public site explains the patent-office access agreement.",
          "सार्वजनिक साइट पेटेंट कार्यालय पहुँच समझौते को स्पष्ट करती है।",
        ),
        citation_ids: ["patents"],
      },
    ];
    result.citations = [cite("patents")];
  } else {
    result.status = "abstained";
    result.title = say(
      "This question needs live research",
      "इस प्रश्न के लिए लाइव शोध चाहिए",
    );
    result.short_answer = say(
      "This demo supports patent, product-classification, ABS, and prior-art examples. It cannot verify an answer to this question. Explore the source library or try one of those examples.",
      "यह डेमो पेटेंट, उत्पाद वर्गीकरण, ABS और पूर्व कला के उदाहरण देता है। इस प्रश्न का उत्तर सत्यापित नहीं कर सकता। स्रोत पुस्तकालय देखें या उदाहरण आज़माएँ।",
    );
  }
  return result;
}
