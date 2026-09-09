# WEDJAT — Do I need a GPU? The free training path

Short answer: **you do not need to buy or rent a GPU**. This document explains
why, and gives the exact free recipes when you DO want real fine-tuning.

---

## 1. What already works with zero GPU, zero cost

WEDJAT's production intelligence path is **RAG (retrieval-augmented generation)**,
and it is fully real today:

| Capability | Status | Where it runs |
|---|---|---|
| Database intake pipeline (§106–§160) | **LIVE** | Vercel serverless |
| Schema analysis, semantic mapping, DQ gates | **LIVE** | Vercel serverless |
| Knowledge extraction → chunking → embedding → indexing | **LIVE** (local 256-dim embedder, LOCAL_ONLY policy) | Turso + serverless |
| Hybrid retrieval (lexical + semantic + rerank) | **LIVE** | Turso + serverless |
| Grounded answers with citations + groundedness scoring | **LIVE** — needs one LLM key | see below |
| Training-candidate capture + human review gates | **LIVE** | Vercel serverless |

For the chat **generation** layer, add ONE free API key on the Vercel project
(Settings → Environment Variables → redeploy):

- **Groq free tier** (`GROQ_API_KEY`, console.groq.com) — fastest free inference,
  generous free quota. Recommended first key.
- or **Gemini free tier** (`GEMINI_API_KEY`, aistudio.google.com) — also free.

Key presence → adapter STANDBY → ACTIVE → router inclusion happens
automatically (§19). Until a key is set, chat returns an honest
"controlled degraded response" — never fabricated answers.

## 2. What "training" means in WEDJAT (and why it is simulated today)

The platform implements the full §38/§41 training lifecycle — dataset
versioning, quality gates, promotion gates (CANDIDATE → CANARY → PRODUCTION),
rollback — because that governance is required regardless of where the math
runs. The **weight-update step** is marked `SIMULATED` because the app itself
runs on serverless CPU. This is the honest engineering choice: the lifecycle
machinery is real, the fine-tune step is not executed in-process.

## 3. The free fine-tuning recipe (real weights, real GPU, $0)

WEDJAT now ships **`GET /api/training/export?datasetVersionId=…`** — every
locked dataset version downloads as LoRA/SFT-ready JSONL
(`{"prompt":…, "completion":…, "type":…, "quality":…}`). In the Training view,
press **"Export JSONL"** on any dataset.

### 3a. Free GPU sources (no credit card)

| Provider | Free quota | Notes |
|---|---|---|
| **Google Colab** (colab.research.google.com) | T4 16GB, ~hours/day | easiest; upload the .jsonl, run the notebook |
| **Kaggle Notebooks** (kaggle.com/code) | 30 GPU-hours/week (P100/T4×2) | best sustained free quota |

### 3b. Notebook skeleton (works on both)

```python
# pip install -q unsloth  (or: transformers+peft+trl)
from unsloth import FastLanguageModel
import json

examples = [json.loads(l) for l in open("wedjat-....jsonl")]
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-4B-Instruct",  # or llama-3.2-3b / mistral-7b
    max_seq_length=2048, load_in_4bit=True,
)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
)
# format each example as the model's chat template with prompt->user, completion->assistant
from trl import SFTTrainer, SFTConfig
trainer = SFTTrainer(
    model=model, tokenizer=tokenizer,
    train_dataset=<formatted examples>,
    args=SFTConfig(per_device_train_batch_size=2, gradient_accumulation_steps=4,
                   num_train_epochs=3, learning_rate=2e-4, output_dir="wedjat-lora"),
)
trainer.train()
model.save_pretrained("wedjat-lora-adapter")  # LoRA adapter (~100MB)
```

### 3c. Serving the trained adapter (also free)

1. **Recommended**: push the adapter to the Hugging Face Hub (free), then point
   a free Groq/Gemini deployment at a hosted base model and keep RAG as the
   grounding layer (the WEDJAT pattern — the adapter adds domain tone, retrieval
   keeps facts correct).
2. Or run the adapter locally with vLLM/llama.cpp and register it in
   **Model Registry** as a new model version (provider `self-hosted`), then
   advance it through CANDIDATE → CANARY → PRODUCTION with the platform's own
   promotion gates (§41: training never auto-deploys).

## 4. Recommended path for your first month live

1. Keep RAG-only + one free inference key (zero cost, answers stay grounded).
2. Upload real data; let training candidates accumulate under human review.
3. Once a locked dataset reaches a few hundred reviewed examples, run the free
   Colab/Kaggle LoRA pass and evaluate whether groundedness/citation quality
   actually improves before promoting anything (§101: don't fine-tune early).

Bottom line: **RAG is the product; fine-tuning is an optional, free-GPU,
human-gated enhancement.** Nothing on your bill requires a GPU.
