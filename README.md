# NexaTel — AI-Powered Telecom Customer Support Platform

> A context-aware telecom support platform combining **NVIDIA NIM**, **semantic vector RAG**, **multi-LLM failover**, **human-in-the-loop escalation**, **Twilio callbacks**, and **SendGrid notifications** in a complete customer + support-agent experience.

---

## Overview

NexaTel is an end-to-end AI customer support prototype designed for telecom use cases such as recharge and payment issues, network and mobile-data troubleshooting, plan and validity support, billing and refund questions, SIM/eSIM support, roaming and ISD, number-related services, and account-specific human escalation.

The goal is not to build a generic chatbot. NexaTel is designed as a **support system** that understands the issue, remembers facts already provided, retrieves relevant telecom knowledge, generates a contextual response, avoids inventing account-specific information, and escalates only when meaningful.

---

## Why I Built This

Traditional support bots often fail in three ways:

- They repeatedly ask for information the customer already provided.
- They return generic answers without using company-specific support knowledge.
- They either escalate too quickly or make human escalation difficult.

NexaTel addresses this with:

**structured conversation state + semantic RAG + LLM generation + controlled human escalation**

Example:

```text
Customer:
My recharge failed but the amount was deducted.

Customer:
₹500 today morning
```

Instead of asking for the amount and time again, NexaTel can keep structured state such as:

```json
{
  "intent": "recharge_issue",
  "amount": 500,
  "transaction_time": "today morning",
  "money_deducted": true,
  "recharge_reflected": false,
  "requires_account_verification": true
}
```

---

## Product Experience

### Customer Experience

The customer application provides:

- Authentication
- New conversations
- Last 5 conversations
- Telecom support categories
- Guided issue prompts
- AI chat
- Feedback controls
- Context-aware troubleshooting
- Support review
- Callback / email preference
- Persistent conversation state

### Support Agent Console

The support console allows an agent to:

- View the support queue
- Read the unresolved issue
- Review the full AI conversation
- See customer contact information
- Move tickets into review
- Resolve tickets
- Start customer callbacks
- Maintain ownership of the support case

---

## Screenshots

Add screenshots to a `docs/` folder and reference them like this:

```markdown
![NexaTel Customer Dashboard](docs/customer-dashboard.png)

![NexaTel Support Console](docs/support-console.png)
```

---

## System Architecture

```text
Customer UI
    ↓
FastAPI API
    ↓
Conversation State Engine
    +
Vector RAG Engine
    +
Escalation Engine
    ↓
NVIDIA Nemotron Embeddings
    ↓
FAISS semantic retrieval
    ↓
LLM Provider Layer
    1. NVIDIA NIM
    2. Gemini
    3. OpenAI
    4. Safe deterministic fallback
    ↓
Contextual customer response
```

Human escalation:

```text
Customer requests support review
        ↓
Support ticket created
        ↓
Agent reviews transcript
        ↓
   Email or Callback
        ↓
SendGrid / Twilio
```

Twilio callback flow:

```text
Customer selects Callback
        ↓
Support request created
        ↓
NO call happens yet
        ↓
Agent reviews ticket
        ↓
Agent clicks "Call customer"
        ↓
Twilio calls SUPPORT AGENT first
        ↓
Agent answers
        ↓
Twilio connects customer
```

---

## AI Architecture

### NVIDIA Embeddings

Primary RAG embedding model:

```text
nvidia/nemotron-3-embed-1b
```

This converts customer queries and knowledge-base documents into semantic vectors.

That allows a query such as:

```text
Money was debited but the pack is still not active.
```

to retrieve guidance about:

```text
Recharge payment deducted but benefits not reflected.
```

even when the wording is different.

### FAISS Vector Retrieval

```text
Customer query
      ↓
Embedding
      ↓
FAISS similarity search
      ↓
Top-K knowledge documents
      ↓
LLM context
```

If FAISS is unavailable, the backend can fall back to NumPy similarity search.

### Context / Conversation State

RAG answers:

> What company knowledge is relevant?

Conversation state answers:

> What has this customer already told us?

These are intentionally separate.

### Multi-LLM Failover

```text
NVIDIA NIM
    ↓ failure
Google Gemini
    ↓ failure
OpenAI
    ↓ failure
Deterministic telecom fallback
```

Primary NVIDIA chat model:

```text
nvidia/llama-3.3-nemotron-super-49b-v1.5
```

---

## Human-in-the-Loop Escalation

NexaTel does not expose an instant support-call bypass.

Instead:

```text
AI troubleshooting
        ↓
Meaningful escalation signal
        ↓
Support Review becomes available
        ↓
Customer submits request
        ↓
Agent receives conversation context
```

Typical escalation signals include:

- Payment deducted but recharge missing
- Duplicate charge
- Account verification required
- Unresolved issue after troubleshooting
- Negative response feedback

---

## Tech Stack

### Backend

- Python
- FastAPI
- Pydantic
- Uvicorn
- JSON / local persistence
- PBKDF2 password hashing

### AI / Retrieval

- NVIDIA NIM
- NVIDIA Nemotron
- Google Gemini
- OpenAI
- FAISS
- Sentence Transformers fallback
- NumPy

### CPaaS / Messaging

- Twilio Voice
- SendGrid Email

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- LocalStorage

---

## Project Structure

```text
nexatel-ai-telecom-support/
│
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── knowledge_base.py
│   ├── knowledge_base.json
│   ├── email_service.py
│   ├── test_sendgrid.py
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── support.html
│   ├── support.css
│   ├── support.js
│   ├── dashboard.html
│   └── dashboard.js
│
├── docs/
│   ├── customer-dashboard.png
│   └── support-console.png
│
├── .gitignore
└── README.md
```

Local runtime files such as `.env`, virtual environments, local databases and generated user data should not be committed.

---

## Environment Configuration

Create `backend/.env` from `backend/.env.example`.

```env
# NVIDIA
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_CHAT_MODEL=nvidia/llama-3.3-nemotron-super-49b-v1.5
NVIDIA_EMBEDDING_MODEL=nvidia/nemotron-3-embed-1b
NVIDIA_EMBEDDING_BATCH_SIZE=16

# RAG
LOCAL_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
KNOWLEDGE_BASE_PATH=knowledge_base.json
RAG_TOP_K=4

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

# SendGrid
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
SUPPORT_AGENT_PHONE=

# Optional admin security
ADMIN_API_KEY=
```

> Never commit `.env` or real API credentials.

---

## Running Locally

### 1. Clone the repository

```bash
git clone https://github.com/dwivedishubham7007/nexatel-ai-telecom-support.git
cd nexatel-ai-telecom-support
```

### 2. Create and activate a virtual environment

```powershell
cd backend
py -m venv venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Configure environment variables

```powershell
Copy-Item .env.example .env
```

Add your real keys to `.env`.

### 5. Run FastAPI

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Swagger:

```text
http://127.0.0.1:8000/docs
```

Health:

```text
http://127.0.0.1:8000/health
```

### 6. Run the frontend

```powershell
cd ../frontend
python -m http.server 5500
```

Customer UI:

```text
http://127.0.0.1:5500
```

Support console:

```text
http://127.0.0.1:5500/support.html
```

---

## API Overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/` | API status |
| `GET` | `/health` | Provider/service health |
| `POST` | `/auth/signup` | Customer registration |
| `POST` | `/auth/login` | Customer login |
| `POST` | `/chat` | Context-aware AI support |
| `POST` | `/support/request` | Create support request |
| `GET` | `/support/requests` | Agent support queue |
| `GET` | `/support/requests/{ticket_id}` | Ticket details |
| `PATCH` | `/support/requests/{ticket_id}` | Update ticket status |
| `POST` | `/support/requests/{ticket_id}/call` | Agent-controlled Twilio callback |

---

## Example Chat Request

```json
{
  "message": "My recharge failed but money was deducted",
  "session_id": "demo-session-001",
  "topic": "recharge"
}
```

Example development response metadata:

```json
{
  "reply": "...",
  "session_id": "demo-session-001",
  "provider": "nvidia",
  "escalation_recommended": false,
  "rag_results": [],
  "issue_state": {}
}
```

---

## Reliability & Safety Decisions

### No invented account information

The LLM must not invent:

- Balance
- Recharge status
- Refund status
- Customer plan
- Account status
- Transaction results

### Provider failures stay internal

Customers should never see raw infrastructure messages such as:

```text
OpenAI quota exceeded
Twilio authentication failed
SendGrid API error
NVIDIA endpoint unavailable
```

### No immediate callback exploitation

Callback requests become tickets. The customer cannot trigger Twilio directly.

### Conversation context is preserved

Short replies such as:

```text
yes
```

can be interpreted against the assistant's previous question.

---

## Key Engineering Decisions

### Why FastAPI?

FastAPI provides typed validation, automatic Swagger docs, clean REST APIs and rapid development.

### Why RAG?

A general LLM does not inherently know NexaTel-specific support procedures.

RAG combines:

```text
General LLM intelligence
        +
NexaTel-specific knowledge
```

without retraining the model.

### Why separate embeddings and generation?

Embedding models are optimized for semantic retrieval. Generative models are optimized for reasoning and conversation.

### Why multi-provider fallback?

Production AI systems should not fail completely because one model provider is unavailable.

### Why human escalation?

AI handles repeatable support issues efficiently; human agents own account-specific, financial, identity-sensitive and unresolved cases.

---

## Future Improvements

- PostgreSQL
- Redis caching
- JWT authentication
- Real telecom CRM integration
- Billing/recharge API integration
- Docker
- Kubernetes
- Rate limiting
- Observability and tracing
- Production vector database
- Agent authentication / RBAC
- Twilio status webhooks
- SLA tracking
- Sentiment / urgency classification
- Automated ticket summarization

---

## What This Project Demonstrates

- AI-assisted product development
- LLM integration
- Retrieval-Augmented Generation
- Semantic search
- Vector retrieval
- Prompt engineering
- Conversation-state management
- API design
- Backend engineering
- Frontend product design
- CPaaS integration
- Human-in-the-loop AI
- Graceful degradation
- Customer-support workflow design

---

## Author

**Shubham Dwivedi**

AI / ML Support • Generative AI • Product Engineering

GitHub:  
`https://github.com/dwivedishubham7007`

LinkedIn:  
`https://www.linkedin.com/in/shubham-dwivedi-7a8381187`

---

## Disclaimer

NexaTel is a portfolio / prototype telecom support application.

Account balances, plans, recharge information and customer records shown in the interface may be demonstration data unless connected to a real telecom backend.

No real customer financial or account action should be performed solely from an LLM response.
