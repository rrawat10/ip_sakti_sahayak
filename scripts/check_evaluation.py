"""Offline judge check: python -m scripts.check_evaluation (from the project root)."""

import os

os.environ["RAGAS_DO_NOT_TRACK"] = "true"
from google import genai
from evaluation.run import create_judge
from ragas.metrics.collections import Faithfulness, ContextRecall

client = genai.Client(api_key="offline-construction-only")
try:
    judge = create_judge(client, "offline-model-not-called")
    assert judge.is_async, "Ragas ascore requires an asynchronous judge client"
    Faithfulness(llm=judge)
    ContextRecall(llm=judge)
    print(
        "Ragas Gemini adapter constructed. No generation or remote tracing requested."
    )
finally:
    client.close()
