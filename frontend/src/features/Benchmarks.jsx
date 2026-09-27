import { useQuery } from "@tanstack/react-query";

async function report(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Benchmark report unavailable");
  return response.json();
}

const percent = (value) =>
  Number.isFinite(value) ? `${Math.round(value * 100)}%` : "Not measured";

export default function Benchmarks({ hi }) {
  const { data: retrieval } = useQuery({
    queryKey: ["corpus-retrieval-benchmark"],
    queryFn: () => report("/benchmarks/retrieval.json"),
    retry: false,
    staleTime: 60_000,
  });
  const { data: answers } = useQuery({
    queryKey: ["answer-quality-benchmark"],
    queryFn: () => report("/benchmarks/report.json"),
    retry: false,
    staleTime: 60_000,
  });
  const retrievalMeasured =
    retrieval?.status === "measured" && retrieval?.rows?.length === 3;
  const answerMeasured =
    answers?.status === "measured" && answers?.rows?.length === 3;

  return (
    <section className="home-section benchmark-section" aria-labelledby="benchmark-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {hi ? "मापने योग्य शोध गुणवत्ता" : "MEASURED RESEARCH QUALITY"}
          </span>
          <h2 id="benchmark-title">
            {hi ? "दावे नहीं, परीक्षण के परिणाम।" : "Evidence, measured in public."}
          </h2>
        </div>
        <span className="benchmark-status">
          {retrievalMeasured || answerMeasured
            ? hi ? "इंजीनियरिंग मूल्यांकन" : "Engineering evaluation"
            : hi ? "मूल्यांकन लंबित" : "Evaluation pending"}
        </span>
      </div>
      <p className="benchmark-intro">
        {hi
          ? "एक ही प्रश्नों और सक्रिय स्रोत संग्रह पर BM25, वेक्टर और हाइब्रिड खोज की तुलना। परिणाम स्वतः प्रकाशित रिपोर्टों से आते हैं।"
          : "BM25, vector and hybrid retrieval run against the same questions and active corpus. These figures come from reproducible reports, not placeholder scores."}
      </p>

      <h3>{hi ? "संपूर्ण सक्रिय कॉर्पस की खोज" : "Active-corpus retrieval"}</h3>
      <div className="benchmark-table-wrap">
        <table className="benchmark-table">
          <caption className="sr-only">Corpus retrieval evaluation</caption>
          <thead><tr>
            <th scope="col">{hi ? "खोज विधि" : "Method"}</th>
            <th scope="col">Hit@{retrieval?.final_k || "K"}</th>
            <th scope="col">MRR@{retrieval?.final_k || "K"}</th>
            <th scope="col">{hi ? "मध्य विलंब" : "Median latency"}</th>
          </tr></thead>
          <tbody>
            {(retrievalMeasured ? retrieval.rows : ["BM25", "Vector", "Hybrid"].map((method) => ({ method }))).map((row) => (
              <tr key={row.method}>
                <th scope="row">{row.method}<small>{row.cases ? `${row.cases} cases` : "Pending"}</small></th>
                <td><span className="benchmark-mobile-label">Hit rate</span><strong>{percent(row.hit_rate_at_k)}</strong></td>
                <td><span className="benchmark-mobile-label">MRR</span><strong>{percent(row.mrr_at_k)}</strong></td>
                <td><span className="benchmark-mobile-label">Latency</span><strong>{Number.isFinite(row.latency_p50_ms) ? `${row.latency_p50_ms} ms` : "Not measured"}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="benchmark-footnote">
        {retrievalMeasured ? <>
          {retrieval.case_count} cases covering {retrieval.document_count} active documents · {retrieval.evaluated_at.slice(0, 10)} · {retrieval.rows.reduce((total, row) => total + row.scope_violations, 0)} scope violations. {retrieval.limitations}{" "}
          <a href="/benchmarks/retrieval.json" target="_blank" rel="noreferrer">Open retrieval report</a>
        </> : hi ? "कॉर्पस मूल्यांकन पूरा होने पर परिणाम यहाँ दिखेंगे।" : "Results appear after every active document has a reviewed retrieval case."}
      </p>

      <h3>{hi ? "उत्तर की गुणवत्ता और सुरक्षित विराम" : "Answer quality and safe abstention"}</h3>
      <div className="benchmark-table-wrap">
        <table className="benchmark-table">
          <caption className="sr-only">Answer quality evaluation</caption>
          <thead><tr>
            <th scope="col">{hi ? "खोज विधि" : "Method"}</th>
            <th scope="col">Ragas faithfulness</th>
            <th scope="col">Recall@{answers?.final_k || 8}</th>
            <th scope="col">{hi ? "सुरक्षित विराम" : "Safe abstention"}</th>
          </tr></thead>
          <tbody>
            {(answerMeasured ? answers.rows : ["BM25", "Vector", "Hybrid"].map((method) => ({ method }))).map((row) => (
              <tr key={row.method}>
                <th scope="row">{row.method}<small>{answers?.summary?.[row.method.toLowerCase()] ? `${Math.round(answers.summary[row.method.toLowerCase()].answer_coverage * 100)}% answered` : "Pending"}</small></th>
                {["faithfulness", "recall", "abstention"].map((metric) => (
                  <td key={metric}><span className="benchmark-mobile-label">{metric}</span><strong>{percent(row[metric]?.mean)}</strong><small>{row[metric]?.n ? `n = ${row[metric].n}` : ""}</small></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="benchmark-footnote">
        {answerMeasured ? <>
          Initial {answers.case_count}-case {answers.split === "held_out" ? "held-out" : "development"} set · {answers.evaluated_at.slice(0, 10)}. Automated judge scores and engineering review do not establish legal correctness.{" "}
          <a href="/benchmarks/report.json" target="_blank" rel="noreferrer">Open answer report</a>
        </> : hi ? "उत्तर मूल्यांकन पूरा होने पर परिणाम यहाँ दिखेंगे।" : "Answer scores appear only after a completed evaluation."}
      </p>
    </section>
  );
}
