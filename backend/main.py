# =============================================================================
# NEXATEL AI TELECOM SUPPORT - FINAL BACKEND 7.1
# =============================================================================
# Provider priority: NVIDIA -> Gemini -> OpenAI -> deterministic fallback
# RAG: NVIDIA Nemotron-3-Embed-1B primary embeddings + local sentence-transformers fallback + FAISS
# Context: per-session structured issue state + recent conversation history
# Human support: ticket queue + SendGrid acknowledgement + agent-first Twilio call
# =============================================================================

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timezone
from html import escape as escape_xml
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from crm_adapter import create_or_sync_crm_ticket, crm_is_configured

# -----------------------------------------------------------------------------
# Environment loading
# -----------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=ENV_FILE)
except Exception:
    pass

# -----------------------------------------------------------------------------
# Optional provider / integration imports.
# The API still starts even when an optional provider package is missing.
# -----------------------------------------------------------------------------
try:
    from openai import OpenAI
    # NVIDIA NIM exposes an OpenAI-compatible API, so this SDK is used
    # for BOTH NVIDIA NIM and OpenAI. NVIDIA traffic is routed by NVIDIA_BASE_URL.
    OPENAI_COMPATIBLE_SDK_AVAILABLE = True
except Exception:
    OpenAI = None
    OPENAI_COMPATIBLE_SDK_AVAILABLE = False

try:
    from google import genai
    GEMINI_SDK_AVAILABLE = True
except Exception:
    genai = None
    GEMINI_SDK_AVAILABLE = False

try:
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Mail
    SENDGRID_SDK_AVAILABLE = True
except Exception:
    SendGridAPIClient = None
    Mail = None
    SENDGRID_SDK_AVAILABLE = False

try:
    from twilio.rest import Client as TwilioClient
    TWILIO_SDK_AVAILABLE = True
except Exception:
    TwilioClient = None
    TWILIO_SDK_AVAILABLE = False

try:
    import faiss
    FAISS_AVAILABLE = True
except Exception:
    faiss = None
    FAISS_AVAILABLE = False

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except Exception:
    SentenceTransformer = None
    SENTENCE_TRANSFORMERS_AVAILABLE = False

# -----------------------------------------------------------------------------
# NVIDIA / LLM provider configuration
# -----------------------------------------------------------------------------
# One NVIDIA API key is used for BOTH:
#   1. NVIDIA_CHAT_MODEL      -> generates customer-facing answers
#   2. NVIDIA_EMBEDDING_MODEL -> creates vectors for semantic RAG retrieval
#
# NVIDIA NIM exposes OpenAI-compatible APIs, so the same `OpenAI` Python SDK
# can talk to NVIDIA simply by setting base_url=NVIDIA_BASE_URL.
# -----------------------------------------------------------------------------
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "").strip()
NVIDIA_BASE_URL = os.getenv(
    "NVIDIA_BASE_URL",
    "https://integrate.api.nvidia.com/v1",
).strip()

# Primary customer-support LLM.
NVIDIA_CHAT_MODEL = os.getenv(
    "NVIDIA_CHAT_MODEL",
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",
).strip()

# Primary embedding model for RAG.
NVIDIA_EMBEDDING_MODEL = os.getenv(
    "NVIDIA_EMBEDDING_MODEL",
    "nvidia/nemotron-3-embed-1b",
).strip()

# Provider fallbacks for response generation.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip()

# Older NexaTel .env files used gemini-2.5-flash. Google now recommends
# gemini-3.6-flash as its replacement, so migrate the legacy value in-memory
# without forcing the local .env file to be edited immediately.
if GEMINI_MODEL in {"gemini-2.5-flash", "models/gemini-2.5-flash"}:
    GEMINI_MODEL = "gemini-3.6-flash"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip()

# -----------------------------------------------------------------------------
# RAG configuration
# -----------------------------------------------------------------------------
KNOWLEDGE_BASE_PATH = Path(
    os.getenv("KNOWLEDGE_BASE_PATH", str(BASE_DIR / "knowledge_base.json"))
)

# If NVIDIA embeddings are temporarily unavailable, the application can still
# retrieve knowledge locally with sentence-transformers.
LOCAL_EMBEDDING_MODEL = os.getenv(
    "LOCAL_EMBEDDING_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
).strip()

RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))

# NVIDIA embedding requests may be sent in batches. Keeping the default modest
# is friendly to hosted trial endpoints and avoids huge request payloads.
NVIDIA_EMBEDDING_BATCH_SIZE = max(
    1,
    int(os.getenv("NVIDIA_EMBEDDING_BATCH_SIZE", "16")),
)

# -----------------------------------------------------------------------------
# Email configuration
# -----------------------------------------------------------------------------
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "").strip()
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL", "").strip()

# -----------------------------------------------------------------------------
# Twilio configuration
# -----------------------------------------------------------------------------
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "").strip()
SUPPORT_AGENT_PHONE = os.getenv("SUPPORT_AGENT_PHONE", "").strip()

# Optional lightweight protection for support-console endpoints.
# Leave empty during local demo. If set, send X-Admin-Key from the support console.
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "").strip()

# -----------------------------------------------------------------------------
# Local JSON persistence
# -----------------------------------------------------------------------------
DATA_DIR = BASE_DIR / "data"
USERS_FILE = DATA_DIR / "users.json"
SUPPORT_REQUESTS_FILE = DATA_DIR / "support_requests.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
USERS_FILE.touch(exist_ok=True)
SUPPORT_REQUESTS_FILE.touch(exist_ok=True)

users_lock = Lock()
support_lock = Lock()


def _ensure_json_array(path: Path) -> None:
    """Ensure a persistence file contains a JSON array."""
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            path.write_text("[]", encoding="utf-8")
            return
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            path.write_text("[]", encoding="utf-8")
    except Exception:
        path.write_text("[]", encoding="utf-8")


_ensure_json_array(USERS_FILE)
_ensure_json_array(SUPPORT_REQUESTS_FILE)


def read_json_list(path: Path) -> List[Dict[str, Any]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except Exception as error:
        print(f"[storage] read failed for {path.name}: {error!r}")
        return []


def write_json_list(path: Path, value: List[Dict[str, Any]]) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


# =============================================================================
# FASTAPI APPLICATION
# =============================================================================
app = FastAPI(
    title="NexaTel AI Telecom Support API",
    version="7.1.0",
    description="Context-aware telecom support with vector RAG and human escalation.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:5501",
        "http://localhost:5501",
        "http://127.0.0.1:5502",
        "http://localhost:5502",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# REQUEST MODELS
# =============================================================================
class SignupRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    phone: Optional[str] = Field(default="", max_length=30)
    password: str = Field(..., min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(..., min_length=1, max_length=200)
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    topic: Optional[str] = None
    channel: str = Field(default="chat", max_length=20)


class VoiceChatRequest(BaseModel):
    """Voice request after ASR converts customer speech into text."""
    transcript: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(..., min_length=1, max_length=200)
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    topic: Optional[str] = None


class ConversationMessage(BaseModel):
    role: str
    content: str
    timestamp: Optional[str] = None


class SupportRequest(BaseModel):
    session_id: str
    conversation_id: Optional[str] = None
    user_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_email: Optional[EmailStr] = None
    customer_phone: Optional[str] = None
    reason: str = Field(..., min_length=2, max_length=800)
    contact_preference: str = "callback"
    channel: str = Field(default="chat", max_length=20)
    conversation: List[ConversationMessage] = Field(default_factory=list)


class SupportTicketUpdate(BaseModel):
    status: str = Field(..., min_length=2, max_length=30)


# =============================================================================
# PASSWORD HELPERS
# =============================================================================
def hash_password(password: str) -> Dict[str, str]:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return {
        "salt": base64.b64encode(salt).decode(),
        "password_hash": base64.b64encode(digest).decode(),
    }


def verify_password(password: str, encoded_salt: str, encoded_hash: str) -> bool:
    try:
        salt = base64.b64decode(encoded_salt)
        expected = base64.b64decode(encoded_hash)
        supplied = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
        return hmac.compare_digest(supplied, expected)
    except Exception:
        return False


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "phone": user.get("phone", ""),
    }


# =============================================================================
# RAG ENGINE
# =============================================================================
def normalize_vectors(vectors: np.ndarray) -> np.ndarray:
    """
    L2-normalize vectors before storing/searching them.

    Why:
    FAISS IndexFlatIP performs inner-product search. Once vectors are normalized,
    inner product is equivalent to cosine similarity, which is a good default for
    semantic retrieval.
    """
    array = np.asarray(vectors, dtype="float32")

    if array.ndim == 1:
        array = array.reshape(1, -1)

    norms = np.linalg.norm(array, axis=1, keepdims=True)
    norms[norms == 0] = 1.0

    return array / norms


def nvidia_embeddings(
    texts: List[str],
    *,
    input_type: str,
) -> np.ndarray:
    """
    Create embeddings using NVIDIA Nemotron-3-Embed-1B.

    input_type:
      - "passage" for knowledge-base documents
      - "query"   for the customer's retrieval query

    Keeping query/passages distinct is useful for retrieval models trained with
    asymmetric retrieval objectives.

    NVIDIA NIM uses an OpenAI-compatible embeddings endpoint, therefore this
    function intentionally uses the OpenAI Python SDK with NVIDIA_BASE_URL.
    """
    if not OPENAI_COMPATIBLE_SDK_AVAILABLE:
        raise RuntimeError("OpenAI-compatible SDK is not installed")

    if not NVIDIA_API_KEY:
        raise RuntimeError("NVIDIA_API_KEY is not configured")

    if not texts:
        return np.empty((0, 0), dtype="float32")

    client = OpenAI(
        api_key=NVIDIA_API_KEY,
        base_url=NVIDIA_BASE_URL,
    )

    all_vectors: List[List[float]] = []

    for start_index in range(0, len(texts), NVIDIA_EMBEDDING_BATCH_SIZE):
        batch = texts[start_index : start_index + NVIDIA_EMBEDDING_BATCH_SIZE]

        # NVIDIA embedding NIMs accept OpenAI-compatible embedding requests.
        # input_type/truncate are NVIDIA retrieval options passed through
        # `extra_body`; if an endpoint ignores an optional field, the standard
        # model/input payload still remains OpenAI-compatible.
        response = client.embeddings.create(
            model=NVIDIA_EMBEDDING_MODEL,
            input=batch,
            encoding_format="float",
            extra_body={
                "input_type": input_type,
                "truncate": "END",
            },
        )

        if not response.data:
            raise RuntimeError("NVIDIA embedding endpoint returned no vectors")

        # Response items contain an index. Sorting protects us from any response
        # ordering differences when embedding a batch.
        ordered = sorted(response.data, key=lambda item: item.index)
        all_vectors.extend(item.embedding for item in ordered)

    vectors = np.asarray(all_vectors, dtype="float32")

    if len(vectors) != len(texts):
        raise RuntimeError(
            "NVIDIA embedding response count did not match the input count"
        )

    return normalize_vectors(vectors)


class RagEngine:
    """
    Semantic vector RAG engine.

    PRIMARY EMBEDDING PROVIDER
    --------------------------
    NVIDIA:
      nvidia/nemotron-3-embed-1b

    LOCAL FALLBACK
    --------------
    sentence-transformers:
      sentence-transformers/all-MiniLM-L6-v2

    VECTOR SEARCH
    -------------
    Preferred:
      FAISS normalized inner-product search (cosine similarity)

    Fallback if FAISS is unavailable:
      NumPy cosine/inner-product ranking

    IMPORTANT DESIGN DETAIL
    -----------------------
    The knowledge-base index and query MUST use embeddings from the same model.
    Therefore the engine remembers which embedding provider successfully built
    the index and always uses that same provider for query vectors.
    """

    def __init__(self) -> None:
        self.lock = Lock()
        self.initialized = False

        self.documents: List[Dict[str, Any]] = []
        self.embeddings: Optional[np.ndarray] = None
        self.index = None

        # "nvidia" or "local"
        self.embedding_provider: Optional[str] = None

        # Loaded only if local fallback is actually needed.
        self.local_model = None

        self.error: Optional[str] = None

    def _load_documents(self) -> List[Dict[str, Any]]:
        """Read and validate knowledge_base.json."""
        if not KNOWLEDGE_BASE_PATH.exists():
            raise RuntimeError(
                f"Knowledge base not found: {KNOWLEDGE_BASE_PATH}"
            )

        payload = json.loads(
            KNOWLEDGE_BASE_PATH.read_text(encoding="utf-8")
        )

        documents = (
            payload.get("documents", [])
            if isinstance(payload, dict)
            else payload
        )

        if not isinstance(documents, list) or not documents:
            raise RuntimeError("Knowledge base contains no documents")

        return documents

    @staticmethod
    def _document_text(document: Dict[str, Any]) -> str:
        """
        Build the text sent to the embedding model.

        Including title + content gives retrieval access to both the topic name
        and the detailed support instructions.
        """
        return (
            f"{document.get('title', '')}\n"
            f"{document.get('content', '')}"
        ).strip()

    def _embed_documents_with_nvidia(
        self,
        texts: List[str],
    ) -> np.ndarray:
        return nvidia_embeddings(
            texts,
            input_type="passage",
        )

    def _embed_query_with_nvidia(
        self,
        query: str,
    ) -> np.ndarray:
        return nvidia_embeddings(
            [query],
            input_type="query",
        )

    def _ensure_local_model(self) -> None:
        """Lazy-load the local embedding model only when NVIDIA is unavailable."""
        if self.local_model is not None:
            return

        if not SENTENCE_TRANSFORMERS_AVAILABLE:
            raise RuntimeError(
                "sentence-transformers is not installed for local RAG fallback"
            )

        self.local_model = SentenceTransformer(
            LOCAL_EMBEDDING_MODEL
        )

    def _embed_documents_locally(
        self,
        texts: List[str],
    ) -> np.ndarray:
        self._ensure_local_model()

        vectors = self.local_model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        )

        return normalize_vectors(
            np.asarray(vectors, dtype="float32")
        )

    def _embed_query_locally(
        self,
        query: str,
    ) -> np.ndarray:
        self._ensure_local_model()

        vector = self.local_model.encode(
            [query],
            normalize_embeddings=True,
            show_progress_bar=False,
        )

        return normalize_vectors(
            np.asarray(vector, dtype="float32")
        )

    def initialize(self) -> None:
        """
        Build the in-memory KB index once.

        Priority:
          1. NVIDIA Nemotron-3-Embed-1B
          2. Local sentence-transformers

        If NVIDIA is configured but temporarily fails, local fallback keeps the
        application functional rather than breaking customer chat.
        """
        if self.initialized:
            return

        with self.lock:
            if self.initialized:
                return

            try:
                self.documents = self._load_documents()

                texts = [
                    self._document_text(document)
                    for document in self.documents
                ]

                # -------------------------------------------------------------
                # PRIMARY: NVIDIA NEMOTRON EMBEDDINGS
                # -------------------------------------------------------------
                if (
                    OPENAI_COMPATIBLE_SDK_AVAILABLE
                    and NVIDIA_API_KEY
                ):
                    try:
                        self.embeddings = (
                            self._embed_documents_with_nvidia(texts)
                        )
                        self.embedding_provider = "nvidia"

                        print(
                            "[rag] embedding provider used: NVIDIA "
                            f"({NVIDIA_EMBEDDING_MODEL})"
                        )

                    except Exception as error:
                        print(
                            "[rag] NVIDIA embedding initialization failed; "
                            f"trying local fallback: {error!r}"
                        )

                # -------------------------------------------------------------
                # FALLBACK: LOCAL SENTENCE TRANSFORMERS
                # -------------------------------------------------------------
                if self.embeddings is None:
                    self.embeddings = (
                        self._embed_documents_locally(texts)
                    )
                    self.embedding_provider = "local"

                    print(
                        "[rag] embedding provider used: local "
                        f"({LOCAL_EMBEDDING_MODEL})"
                    )

                if (
                    self.embeddings is None
                    or self.embeddings.size == 0
                ):
                    raise RuntimeError(
                        "No knowledge-base embeddings were generated"
                    )

                # -------------------------------------------------------------
                # BUILD VECTOR INDEX
                # -------------------------------------------------------------
                if FAISS_AVAILABLE:
                    dimension = int(
                        self.embeddings.shape[1]
                    )

                    self.index = faiss.IndexFlatIP(
                        dimension
                    )

                    self.index.add(
                        self.embeddings
                    )

                self.error = None
                self.initialized = True

                print(
                    f"[rag] initialized: docs={len(self.documents)}, "
                    f"embedding_provider={self.embedding_provider}, "
                    f"backend={'FAISS' if FAISS_AVAILABLE else 'NumPy'}"
                )

            except Exception as error:
                self.error = str(error)
                self.initialized = True

                print(
                    f"[rag] initialization failed: {error!r}"
                )

    def _embed_query(
        self,
        query: str,
    ) -> np.ndarray:
        """
        Embed the query with the SAME provider that built the knowledge index.
        Mixing vector spaces from two models would make similarity scores invalid.
        """
        if self.embedding_provider == "nvidia":
            return self._embed_query_with_nvidia(query)

        if self.embedding_provider == "local":
            return self._embed_query_locally(query)

        raise RuntimeError(
            "RAG embedding provider has not been initialized"
        )

    def search(
        self,
        query: str,
        top_k: int = RAG_TOP_K,
    ) -> List[Dict[str, Any]]:
        """Return the top semantically relevant NexaTel knowledge documents."""
        self.initialize()

        if (
            self.error
            or self.embeddings is None
            or not self.documents
        ):
            return []

        try:
            query_vector = self._embed_query(query)

            k = min(
                top_k,
                len(self.documents),
            )

            if self.index is not None:
                scores, indices = self.index.search(
                    query_vector,
                    k,
                )

                pairs = zip(
                    scores[0].tolist(),
                    indices[0].tolist(),
                )

            else:
                # NumPy fallback if FAISS is unavailable.
                scores = np.dot(
                    self.embeddings,
                    query_vector[0],
                )

                indices = np.argsort(
                    scores
                )[::-1][:k]

                pairs = [
                    (
                        float(scores[index]),
                        int(index),
                    )
                    for index in indices
                ]

            results: List[Dict[str, Any]] = []

            for score, document_index in pairs:
                if (
                    document_index < 0
                    or document_index >= len(self.documents)
                ):
                    continue

                document = dict(
                    self.documents[document_index]
                )

                document["score"] = round(
                    float(score),
                    4,
                )

                results.append(
                    document
                )

            return results

        except Exception as error:
            print(
                f"[rag] search failed: {error!r}"
            )

            return []


rag_engine = RagEngine()


# =============================================================================
# CONVERSATION MEMORY / STRUCTURED ISSUE STATE
# =============================================================================
MAX_HISTORY_MESSAGES = 16
conversation_history: Dict[str, List[Dict[str, str]]] = {}
issue_state_store: Dict[str, Dict[str, Any]] = {}


def default_issue_state() -> Dict[str, Any]:
    return {
        "intent": None,
        "amount": None,
        "transaction_time": None,
        "money_deducted": None,
        "recharge_reflected": None,
        "last_question": None,
        "requires_account_verification": False,
        "escalation_eligible": False,
        "turns": 0,
    }


def detect_intent(message: str, topic: Optional[str], current: Optional[str]) -> Optional[str]:
    lower = message.lower()

    if topic in {"recharge", "billing"}:
        return "recharge_issue" if topic == "recharge" else "billing_issue"
    if topic == "network":
        return "network_issue"
    if topic == "sim":
        return "sim_issue"
    if topic == "roaming":
        return "roaming_issue"
    if topic == "number":
        return "number_service"
    if topic == "account":
        return "plan_account"

    if any(x in lower for x in ["recharge", "recharged", "top up", "top-up"]):
        return "recharge_issue"
    if any(x in lower for x in ["network", "signal", "mobile data", "internet", "5g", "4g"]):
        return "network_issue"
    if any(x in lower for x in ["sim", "esim"]):
        return "sim_issue"
    if any(x in lower for x in ["roaming", "isd", "international calling"]):
        return "roaming_issue"
    if any(x in lower for x in ["bill", "billing", "refund", "charged twice", "overcharged"]):
        return "billing_issue"
    if any(x in lower for x in ["plan", "validity", "balance"]):
        return "plan_account"

    return current


def extract_amount(message: str, intent: Optional[str]) -> Optional[float]:
    """Extract a likely money amount for transaction-related conversations."""
    if intent not in {"recharge_issue", "billing_issue"}:
        return None

    patterns = [
        r"(?:₹|rs\.?|inr)\s*([0-9]+(?:\.[0-9]{1,2})?)",
        r"\b([0-9]{2,5}(?:\.[0-9]{1,2})?)\s*(?:rupees?|rs|inr)\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if match:
            return float(match.group(1))

    # In a recharge flow, a short numeric message such as "500 today morning"
    # is very likely the recharge amount.
    if intent == "recharge_issue":
        match = re.search(r"\b([1-9][0-9]{1,4})\b", message)
        if match:
            return float(match.group(1))

    return None


def extract_time_phrase(message: str) -> Optional[str]:
    """Extract an approximate transaction time from a short customer reply."""
    lower = message.lower().strip()

    candidates = [
        "today morning", "this morning",
        "today afternoon", "this afternoon",
        "today evening", "this evening",
        "last night",
        "yesterday morning", "yesterday afternoon", "yesterday evening",
        "yesterday", "today", "just now",
        "a few minutes ago", "an hour ago",
    ]

    for phrase in candidates:
        if phrase in lower:
            return phrase

    # Also understand concise replies such as:
    #   8 AM
    #   8:30 pm
    #   20:15
    clock_match = re.search(
        r"\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b",
        lower,
        flags=re.IGNORECASE,
    )
    if clock_match:
        return clock_match.group(0).strip()

    return None

def interpret_yes_no(message: str) -> Optional[bool]:
    normalized = re.sub(r"[^a-z]", "", message.lower())
    if normalized in {"yes", "y", "yeah", "yep", "correct", "true", "haan", "ha", "han"}:
        return True
    if normalized in {"no", "n", "nope", "false", "nah", "nahi", "nhi"}:
        return False
    return None


def update_issue_state(session_id: str, message: str, topic: Optional[str]) -> Dict[str, Any]:
    """
    Update structured facts independently from the LLM.

    This is what lets NexaTel understand short follow-ups such as "₹500",
    "yes" and "8 AM" without asking the customer to repeat information.
    """
    state = issue_state_store.setdefault(session_id, default_issue_state())
    state["turns"] += 1

    state["intent"] = detect_intent(message, topic, state.get("intent"))
    lower = message.lower()

    # Amount: works both in full sentences and short recharge-flow replies.
    amount = extract_amount(message, state.get("intent"))
    if amount is not None:
        state["amount"] = amount

    # Approximate time: includes natural phrases and clock times such as 8 AM.
    time_phrase = extract_time_phrase(message)
    if time_phrase:
        state["transaction_time"] = time_phrase

    # Contextual yes/no answers are interpreted using the last question type.
    yes_no = interpret_yes_no(message)
    if yes_no is not None and state.get("last_question") == "money_deducted":
        state["money_deducted"] = yes_no

    # Explicit payment-deduction signals.
    if any(
        phrase in lower
        for phrase in [
            "money deducted",
            "amount deducted",
            "payment deducted",
            "money was deducted",
            "amount was deducted",
            "payment was deducted",
            "was deducted",
            "debited",
        ]
    ):
        state["money_deducted"] = True

    # Common ways customers describe a recharge that has not arrived.
    if any(
        phrase in lower
        for phrase in [
            "recharge not reflecting",
            "recharge isn't reflecting",
            "recharge is not reflecting",
            "not reflected",
            "not showing",
            "not credited",
            "not received",
            "recharge missing",
            "benefits not active",
            "recharge failed",
            "recharge not working",
            "recharge isn't working",
            "recharge is not working",
        ]
    ):
        state["recharge_reflected"] = False

    if any(
        phrase in lower
        for phrase in [
            "recharge reflected",
            "now reflected",
            "recharge credited",
            "now credited",
            "now working",
            "resolved",
        ]
    ):
        state["recharge_reflected"] = True

    # "I still need the recharge to reflect" also means it is currently absent.
    if state.get("intent") == "recharge_issue" and "reflect" in lower and "not" not in lower:
        if any(phrase in lower for phrase in ["need", "want", "still"]):
            state["recharge_reflected"] = False

    # Account/transaction verification is conceptually required once we know
    # money was deducted while the recharge is still missing.
    state["requires_account_verification"] = bool(
        state.get("intent") == "recharge_issue"
        and state.get("money_deducted") is True
        and state.get("recharge_reflected") is False
    )

    # Human review should not become an instant shortcut. For the standard
    # deducted-but-not-credited flow, collect amount + approximate time first.
    transaction_context_ready = bool(
        state["requires_account_verification"]
        and state.get("amount") is not None
        and state.get("transaction_time")
    )

    if state["requires_account_verification"]:
        # For a deducted-but-missing recharge, do not expose human review until
        # the key transaction facts are ready for the agent handoff.
        state["escalation_eligible"] = transaction_context_ready
    else:
        # Other unresolved billing/recharge conversations can become eligible
        # after several turns even when they do not match the strict transaction
        # verification state machine above.
        state["escalation_eligible"] = bool(
            state.get("intent") in {"recharge_issue", "billing_issue"}
            and state.get("turns", 0) >= 3
        )

    issue_state_store[session_id] = state
    return state

def known_facts_text(state: Dict[str, Any]) -> str:
    facts = []
    if state.get("intent"):
        facts.append(f"Issue: {state['intent']}")
    if state.get("amount") is not None:
        amount = state["amount"]
        amount_display = int(amount) if float(amount).is_integer() else amount
        facts.append(f"Recharge/payment amount: ₹{amount_display}")
    if state.get("transaction_time"):
        facts.append(f"Transaction time: {state['transaction_time']}")
    if state.get("recharge_reflected") is not None:
        facts.append(f"Recharge reflected: {state['recharge_reflected']}")
    if state.get("money_deducted") is not None:
        facts.append(f"Money deducted: {state['money_deducted']}")
    if state.get("last_question"):
        facts.append(f"Last question type: {state['last_question']}")
    return "\n".join(f"- {fact}" for fact in facts) if facts else "- No structured facts extracted yet."


def deterministic_context_response(state: Dict[str, Any]) -> Optional[str]:
    """
    High-confidence state machine for a recharge that is not credited.

    It deliberately asks ONE thing at a time and prevents the model from
    producing checklist-style support responses for this common workflow.
    """
    if state.get("intent") != "recharge_issue":
        return None

    amount = state.get("amount")
    when = state.get("transaction_time")
    reflected = state.get("recharge_reflected")
    deducted = state.get("money_deducted")

    # Only take deterministic control once the customer has indicated that the
    # recharge is missing/not working. Other recharge questions can still use RAG.
    if reflected is not False:
        return None

    # Step 1: amount.
    if amount is None:
        state["last_question"] = "amount"
        return "I can help with that. What was the recharge amount?"

    amount_display = int(amount) if float(amount).is_integer() else amount

    # If the amount is known but deduction status is not, ask only that next.
    if deducted is None:
        state["last_question"] = "money_deducted"
        return (
            f"Thanks. Was the ₹{amount_display} amount successfully deducted "
            "from your bank, card or UPI account?"
        )

    # Deduction confirmed, now collect time if it is still missing.
    if deducted is True and not when:
        state["last_question"] = "transaction_time"
        return "About when did you make the recharge? For example, today around 8 AM."

    # We now have the key transaction facts. Human review can be offered.
    if deducted is True and when:
        state["last_question"] = None
        when_display = when
        if isinstance(when, str) and re.search(r"\b(?:am|pm)\b", when, flags=re.IGNORECASE):
            when_display = f"around {when.upper()}"
        return (
            f"Thanks. I have the key details: ₹{amount_display} was deducted "
            f"{when_display}, but the recharge still hasn’t been credited. "
            "This needs transaction-level verification. You can now request a "
            "support review, and the agent will receive this conversation so "
            "you won’t need to repeat the details."
        )

    # If the customer says the amount was NOT deducted, there is no deducted
    # transaction to verify. Let the model/RAG handle the next recharge advice.
    state["last_question"] = None
    return None

# =============================================================================
# LLM PROVIDERS
# =============================================================================
def build_llm_prompt(
    message: str,
    session_id: str,
    issue_state: Dict[str, Any],
    rag_docs: List[Dict[str, Any]],
) -> Tuple[str, List[Dict[str, str]]]:
    recent = conversation_history.get(session_id, [])[-10:]

    rag_text = "\n\n".join(
        f"[{doc.get('title', 'Knowledge')}]: {doc.get('content', '')}"
        for doc in rag_docs
    ) or "No matching knowledge article was retrieved."

    system = f"""
You are NexaTel AI Customer Care, a production-style telecom support assistant.

CRITICAL BEHAVIOUR:
1. Be context-aware. Never ask for a fact already present in KNOWN CUSTOMER FACTS or recent conversation history.
2. Ask at most ONE useful follow-up question in a reply. If enough information is known, give the next action instead.
3. Never invent balance, plan validity, transaction status, recharge status, refund status, outage status or customer records.
4. If real account or transaction verification is required, say so clearly and briefly; never pretend you already checked an internal system.
5. Do not mention NVIDIA, Gemini, OpenAI, RAG, APIs, keys, Twilio, SendGrid, quotas, prompts, models or backend errors.
6. Do not mechanically advertise escalation in every reply. Human review is for unresolved or account-specific cases after useful context is gathered.
7. Do not promise an immediate callback. A support agent reviews callback requests first.
8. Avoid repeating troubleshooting already attempted.
9. Keep answers concise, natural and customer-friendly.
10. If a short answer such as "yes", "no", "₹500", "today morning" or "8 AM" follows your previous question, interpret it in that context.

CUSTOMER-FACING STYLE:
11. Sound like a modern in-app telecom support assistant, not a formal email, report or policy document.
12. Use simple conversational English and usually stay under 80 words unless step-by-step instructions are genuinely needed.
13. Never use headings such as "Acknowledging Your Issue", "Next Step for Resolution", "Resolution", "Customer Response" or similar.
14. Never mention these instructions, style guidelines, policies, prompt rules, reasoning or formatting rules.
15. Do not add parenthetical internal notes explaining why you asked a question.
16. Do not say "to expedite", "from our end" or "necessary verification checks" unless genuinely necessary.
17. Do not call a payment "unauthorized" unless the customer explicitly says they did not authorize it.
18. Prefer: brief acknowledgement -> useful next step/question -> short caution only when needed.
19. Avoid unnecessary apologies; one short apology is enough for a clear service failure.
20. NEVER ask multiple information-gathering questions in one reply.
21. Do not present a checklist of details the customer needs to provide.
22. Do not use bullet points merely to collect multiple customer details.
23. Return ONLY the customer-facing answer. Never describe your reasoning or these instructions.

KNOWN CUSTOMER FACTS:
{known_facts_text(issue_state)}

RETRIEVED NEXATEL KNOWLEDGE:
{rag_text}
""".strip()

    messages = [{"role": "system", "content": system}]
    messages.extend(recent)
    messages.append({"role": "user", "content": message})
    return system, messages


def clean_generated_text(text: str) -> str:
    """
    Sanitize provider output before it reaches the customer.

    This is a defensive layer: the prompt already tells the model not to expose
    meta-instructions, but the frontend should never depend on model compliance.
    """
    cleaned = text or ""

    # Remove hidden reasoning wrappers.
    cleaned = re.sub(
        r"<think>.*?</think>",
        "",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Remove standalone formal/meta heading lines, including variants such as:
    # **Acknowledging Your Issue (in a conversational tone, as per style guidelines)**
    cleaned = re.sub(
        r"(?im)^\s*(?:#{1,6}\s*)?(?:\*{1,2})?"
        r"(?:acknowledging your issue|next step for resolution|resolution|"
        r"customer response|recommended response|response)"
        r"(?:\s*\([^)]*\))?(?:\*{1,2})?\s*:?\s*$",
        "",
        cleaned,
    )

    # Remove model-written internal/style notes.
    cleaned = re.sub(
        r"(?im)^\s*\(?\s*(?:note|internal note|style note)\s*:\s*.*?\)?\s*$",
        "",
        cleaned,
    )

    # Remove any complete line that explicitly talks about internal style/prompt
    # instructions. This is intentionally narrow so ordinary support content is
    # not accidentally deleted.
    cleaned = re.sub(
        r"(?im)^.*(?:as per (?:the )?style guidelines|"
        r"according to (?:the )?style guidelines|"
        r"following (?:the )?style guidelines|"
        r"as instructed by (?:the )?prompt).*?$",
        "",
        cleaned,
    )

    # Remove leftover Markdown heading markers and excessive blank space.
    cleaned = re.sub(r"(?m)^\s*#{1,6}\s+", "", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    return cleaned

def call_nvidia(messages: List[Dict[str, str]]) -> str:
    """
    Primary customer-response provider:

      nvidia/llama-3.3-nemotron-super-49b-v1.5

    NVIDIA's hosted NIM endpoint is OpenAI-compatible, so this intentionally
    uses `OpenAI(...)` with NVIDIA_BASE_URL.

    For customer care we request reasoning-OFF behaviour with `/no_think`.
    That keeps latency/output concise and prevents chain-of-thought style text
    from reaching the customer.
    """
    if not OPENAI_COMPATIBLE_SDK_AVAILABLE or not NVIDIA_API_KEY:
        raise RuntimeError("NVIDIA provider not configured")

    client = OpenAI(
        api_key=NVIDIA_API_KEY,
        base_url=NVIDIA_BASE_URL,
    )

    # Clone the messages so provider-specific instructions never leak into the
    # Gemini or OpenAI fallback prompts.
    nvidia_messages = [
        {
            "role": item["role"],
            "content": item["content"],
        }
        for item in messages
    ]

    if (
        nvidia_messages
        and nvidia_messages[0].get("role") == "system"
    ):
        nvidia_messages[0]["content"] = (
            "/no_think\n"
            + nvidia_messages[0]["content"]
        )
    else:
        nvidia_messages.insert(
            0,
            {
                "role": "system",
                "content": (
                    "/no_think\n"
                    "Answer as NexaTel customer support. "
                    "Return only the customer-facing answer."
                ),
            },
        )

    response = client.chat.completions.create(
        model=NVIDIA_CHAT_MODEL,
        messages=nvidia_messages,

        # Reasoning-OFF mode is best kept deterministic for a support workflow.
        temperature=0.0,
        top_p=1.0,

        # Support answers should remain concise even though the model supports
        # a much larger context/output window.
        max_tokens=350,

        frequency_penalty=0,
        presence_penalty=0,
    )

    raw_text = response.choices[0].message.content

    if not raw_text or not raw_text.strip():
        raise RuntimeError("NVIDIA returned an empty response")

    answer = clean_generated_text(
        raw_text
    )

    if not answer:
        raise RuntimeError(
            "NVIDIA returned no customer-facing answer after sanitization"
        )

    return answer


def call_gemini(system: str, messages: List[Dict[str, str]]) -> str:
    if not GEMINI_SDK_AVAILABLE or not GEMINI_API_KEY:
        raise RuntimeError("Gemini provider not configured")

    client = genai.Client(api_key=GEMINI_API_KEY)

    transcript_parts = [system, "\n\nRECENT CONVERSATION:"]
    for item in messages[1:]:
        transcript_parts.append(f"{item['role'].upper()}: {item['content']}")

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents="\n".join(transcript_parts),
    )
    text = getattr(response, "text", None)
    if not text or not text.strip():
        raise RuntimeError("Gemini returned an empty response")
    return clean_generated_text(text)


def call_openai(messages: List[Dict[str, str]]) -> str:
    if not OPENAI_COMPATIBLE_SDK_AVAILABLE or not OPENAI_API_KEY:
        raise RuntimeError("OpenAI provider not configured")

    client = OpenAI(api_key=OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        temperature=0.25,
        max_tokens=500,
    )
    text = response.choices[0].message.content
    if not text or not text.strip():
        raise RuntimeError("OpenAI returned an empty response")
    return clean_generated_text(text)


def deterministic_fallback(message: str, state: Dict[str, Any], rag_docs: List[Dict[str, Any]]) -> str:
    context_specific = deterministic_context_response(state)
    if context_specific:
        return context_specific

    lower = message.lower()
    if any(x in lower for x in ["network", "signal", "internet", "data", "4g", "5g"]):
        return (
            "I can help troubleshoot that. Toggle airplane mode for about 10 seconds, restart the phone, "
            "and tell me whether the issue happens everywhere or only in one location."
        )
    if any(x in lower for x in ["sim", "esim"]):
        return (
            "I can help with SIM or eSIM support. Tell me whether this is activation, replacement, "
            "a lost SIM, or eSIM setup. Account-level actions may require identity verification."
        )
    if any(x in lower for x in ["roaming", "isd", "international"]):
        return (
            "I can help with roaming or international calling. Tell me whether you are setting it up, "
            "already abroad, or facing a data/calling issue while roaming."
        )
    if any(x in lower for x in ["plan", "validity", "balance"]):
        return (
            "I can explain plan, validity and account concepts, but I won’t invent account-specific values. "
            "Tell me which part you want help with."
        )

    if rag_docs:
        return (
            "I found relevant NexaTel guidance for this issue. Tell me what you expected to happen, "
            "what actually happened, and any troubleshooting you have already tried."
        )

    return (
        "I can help investigate that. Tell me what you expected to happen, what actually happened, "
        "and whether you have already tried any troubleshooting."
    )


def generate_response(
    message: str,
    session_id: str,
    issue_state: Dict[str, Any],
    rag_docs: List[Dict[str, Any]],
) -> Tuple[str, str]:
    # First use the deterministic state machine where we have a high-confidence
    # next step. This guarantees no repetitive amount/time question in the
    # recharge-not-reflected flow.
    direct = deterministic_context_response(issue_state)
    if direct:
        return direct, "context-engine"

    system, messages = build_llm_prompt(message, session_id, issue_state, rag_docs)

    providers = [
        ("nvidia", lambda: call_nvidia(messages)),
        ("gemini", lambda: call_gemini(system, messages)),
        ("openai", lambda: call_openai(messages)),
    ]

    for provider_name, provider_call in providers:
        try:
            reply = provider_call()
            print(f"[llm] provider used: {provider_name}")
            return reply, provider_name
        except Exception as error:
            print(f"[llm] {provider_name} unavailable/failed: {error!r}")

    return deterministic_fallback(message, issue_state, rag_docs), "fallback"


# =============================================================================
# OMNICHANNEL / AGENT HANDOFF HELPERS
# =============================================================================
def sanitize_channel(channel: Optional[str]) -> str:
    value=(channel or "chat").strip().lower()
    return value if value in {"chat","voice"} else "chat"

def infer_ticket_issue(text: str) -> str:
    lower=text.lower()
    if any(x in lower for x in ["recharge","top up","top-up"]): return "Recharge / payment"
    if any(x in lower for x in ["network","signal","internet","data","4g","5g"]): return "Network / data"
    if any(x in lower for x in ["refund","billing","bill","charged","payment"]): return "Billing / refund"
    if any(x in lower for x in ["sim","esim"]): return "SIM / eSIM"
    if any(x in lower for x in ["roaming","isd","international"]): return "Roaming / ISD"
    if any(x in lower for x in ["plan","validity","balance"]): return "Plan / account"
    return "General support"

def build_agent_case_summary(request: SupportRequest, issue_state: Optional[Dict[str,Any]]) -> Dict[str,Any]:
    state=issue_state or {}
    transcript=" ".join(x.content for x in request.conversation if x.content)
    known=[]
    if state.get("amount") is not None:
        amount=state["amount"]; display=int(amount) if float(amount).is_integer() else amount
        known.append(f"Amount: ₹{display}")
    if state.get("transaction_time"): known.append(f"Transaction time: {state['transaction_time']}")
    if state.get("money_deducted") is True: known.append("Payment was deducted")
    elif state.get("money_deducted") is False: known.append("Payment was not deducted")
    if state.get("recharge_reflected") is False: known.append("Recharge / benefit is not reflected")
    if state.get("requires_account_verification"):
        reason="Account or transaction-level verification is required."
        action="Verify the account/transaction in the CRM or billing system, then continue from the captured AI context without asking the customer to repeat the issue."
    else:
        reason=request.reason.strip()
        action="Review the transcript, verify account-specific details in the system of record, and continue from where AI troubleshooting stopped."
    return {"issue":infer_ticket_issue(f"{request.reason} {transcript}"),"summary":request.reason.strip(),"known_facts":known,"escalation_reason":reason,"recommended_action":action,"channel":sanitize_channel(request.channel)}


# =============================================================================
# SUPPORT / EMAIL / TWILIO HELPERS
# =============================================================================
def model_to_dict(model: BaseModel) -> Dict[str, Any]:
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def normalize_status(status: str) -> str:
    value = (status or "waiting").strip().lower()
    aliases = {
        "open": "waiting",
        "pending": "waiting",
        "new": "waiting",
        "in_progress": "reviewing",
        "under_review": "reviewing",
        "review": "reviewing",
        "closed": "resolved",
        "complete": "resolved",
        "completed": "resolved",
    }
    return aliases.get(value, value)


def determine_priority(reason: str, conversation: List[ConversationMessage]) -> str:
    combined = reason.lower() + " " + " ".join(m.content.lower() for m in conversation)
    urgent = [
        "charged twice", "double charged", "money deducted", "payment deducted",
        "fraud", "unauthorised", "unauthorized", "sim blocked", "lost sim",
    ]
    return "high" if any(term in combined for term in urgent) else "normal"


def send_acknowledgement(email: str, name: str, ticket_id: str, preference: str) -> None:
    if not email:
        return

    if not (SENDGRID_SDK_AVAILABLE and SENDGRID_API_KEY and SENDGRID_FROM_EMAIL):
        print("[email] SendGrid not configured; acknowledgement skipped")
        return

    try:
        next_step = (
            "A support agent will review your conversation first. If a call is appropriate, the agent will contact you."
            if preference == "callback"
            else "A support agent will review your conversation and follow up by email."
        )

        message = Mail(
            from_email=SENDGRID_FROM_EMAIL,
            to_emails=email,
            subject=f"NexaTel support request received - {ticket_id}",
            plain_text_content=(
                f"Hi {name or 'there'},\n\n"
                "We have received your NexaTel support request.\n\n"
                f"Reference: {ticket_id}\n\n"
                f"{next_step}\n\n"
                "Regards,\nNexaTel Customer Care"
            ),
        )
        result = SendGridAPIClient(SENDGRID_API_KEY).send(message)
        print(f"[email] acknowledgement sent, status={result.status_code}")
    except Exception as error:
        print(f"[email] acknowledgement failed: {error!r}")


def twilio_is_configured() -> bool:
    return bool(
        TWILIO_SDK_AVAILABLE
        and TWILIO_ACCOUNT_SID
        and TWILIO_AUTH_TOKEN
        and TWILIO_PHONE_NUMBER
        and SUPPORT_AGENT_PHONE
    )


def normalize_phone_number(phone: Optional[str]) -> str:
    """
    Normalize common formatting without guessing a country code.

    Example:
        +91 88876 74925  -> +918887674925

    If the customer enters a local number without a leading +country-code, we
    keep it as-is so the application does not silently guess the wrong country.
    """
    value = (phone or "").strip()
    if not value:
        return ""

    # Remove spaces, dashes and parentheses only.
    compact = re.sub(r"[\s\-()]", "", value)
    return compact


def valid_e164_phone(phone: Optional[str]) -> bool:
    normalized = normalize_phone_number(phone)
    return bool(re.fullmatch(r"\+[1-9]\d{7,14}", normalized))


def verify_admin_access(supplied_key: Optional[str]) -> None:
    if not ADMIN_API_KEY:
        return
    if not supplied_key:
        raise HTTPException(status_code=401, detail="Admin authentication required.")
    if not hmac.compare_digest(supplied_key, ADMIN_API_KEY):
        raise HTTPException(status_code=403, detail="Invalid admin credentials.")


# =============================================================================
# BASIC ENDPOINTS
# =============================================================================
@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "message": "NexaTel AI Telecom Support API is running",
        "version": "7.1.0",
        "docs": "/docs",
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "services": {
            "nvidia_configured": bool(
                OPENAI_COMPATIBLE_SDK_AVAILABLE and NVIDIA_API_KEY
            ),
            "nvidia_chat_model": NVIDIA_CHAT_MODEL,
            "nvidia_embedding_model": NVIDIA_EMBEDDING_MODEL,
            "gemini_configured": bool(GEMINI_SDK_AVAILABLE and GEMINI_API_KEY),
            "openai_configured": bool(OPENAI_COMPATIBLE_SDK_AVAILABLE and OPENAI_API_KEY),
            "rag_available": bool(
                (OPENAI_COMPATIBLE_SDK_AVAILABLE and NVIDIA_API_KEY)
                or SENTENCE_TRANSFORMERS_AVAILABLE
            ),
            "rag_embedding_provider": rag_engine.embedding_provider,
            "rag_backend": "faiss" if FAISS_AVAILABLE else "numpy-fallback",
            "rag_initialized": rag_engine.initialized and not rag_engine.error,
            "sendgrid_configured": bool(
                SENDGRID_SDK_AVAILABLE and SENDGRID_API_KEY and SENDGRID_FROM_EMAIL
            ),
            "twilio_configured": twilio_is_configured(),
            "crm_connector_ready": crm_is_configured(),
            "voice_pipeline_ready": True,
        },
    }


# =============================================================================
# AUTHENTICATION ENDPOINTS
# =============================================================================
@app.post("/auth/signup")
def signup(request: SignupRequest) -> Dict[str, Any]:
    email = str(request.email).strip().lower()
    name = request.name.strip()
    phone = normalize_phone_number(request.phone)

    with users_lock:
        users = read_json_list(USERS_FILE)
        if any(user.get("email", "").lower() == email for user in users):
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Please sign in instead.",
            )

        password_data = hash_password(request.password)
        user = {
            "id": f"user_{uuid.uuid4().hex[:12]}",
            "name": name,
            "email": email,
            "phone": phone,
            "salt": password_data["salt"],
            "password_hash": password_data["password_hash"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        users.append(user)
        write_json_list(USERS_FILE, users)

    return {"message": "Account created successfully.", "user": public_user(user)}


@app.post("/auth/login")
def login(request: LoginRequest) -> Dict[str, Any]:
    email = str(request.email).strip().lower()
    users = read_json_list(USERS_FILE)
    user = next((u for u in users if u.get("email", "").lower() == email), None)

    if not user or not verify_password(
        request.password,
        user.get("salt", ""),
        user.get("password_hash", ""),
    ):
        raise HTTPException(status_code=401, detail="The email or password is incorrect.")

    return {"message": "Signed in successfully.", "user": public_user(user)}


# =============================================================================
# CHAT ENDPOINT
# =============================================================================
def process_support_turn(*, message: str, session_id: str, topic: Optional[str], channel: str) -> Dict[str,Any]:
    """Shared context + RAG + LLM pipeline for chat and voice transcripts."""
    channel=sanitize_channel(channel)
    issue_state=update_issue_state(session_id,message,topic)
    issue_state["channel"]=channel
    rag_docs=rag_engine.search(f"Channel: {channel}\n{message}\n{known_facts_text(issue_state)}",top_k=RAG_TOP_K)
    reply,provider=generate_response(message,session_id,issue_state,rag_docs)
    history=conversation_history.setdefault(session_id,[])
    history.append({"role":"user","content":message}); history.append({"role":"assistant","content":reply})
    conversation_history[session_id]=history[-MAX_HISTORY_MESSAGES:]
    issue_state_store[session_id]=issue_state
    return {"reply":reply,"session_id":session_id,"channel":channel,"provider":provider,"escalation_recommended":bool(issue_state.get("escalation_eligible")),"needs_human_review":bool(issue_state.get("escalation_eligible")),"rag_results":[{"title":d.get("title"),"score":d.get("score")} for d in rag_docs],"issue_state":issue_state}

@app.post("/chat")
def chat(request: ChatRequest) -> Dict[str,Any]:
    return process_support_turn(message=request.message.strip(),session_id=request.session_id.strip(),topic=request.topic,channel=request.channel)

@app.post("/voice/chat")
def voice_chat(request: VoiceChatRequest) -> Dict[str,Any]:
    """ASR transcript in; same NexaTel intelligence; provider-neutral TTS text out."""
    result=process_support_turn(message=request.transcript.strip(),session_id=request.session_id.strip(),topic=request.topic,channel="voice")
    result["speak_text"]=result["reply"]
    return result


# =============================================================================
# SUPPORT REQUEST ENDPOINTS
# =============================================================================
@app.post("/support/request")
def create_support_request(
    request: SupportRequest,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    preference = request.contact_preference.strip().lower()
    if preference not in {"callback", "email"}:
        raise HTTPException(status_code=400, detail="Contact preference must be callback or email.")

    ticket_id = (
        "NX-"
        + datetime.now(timezone.utc).strftime("%Y%m%d")
        + "-"
        + uuid.uuid4().hex[:6].upper()
    )
    now = datetime.now(timezone.utc).isoformat()

    normalized_channel=sanitize_channel(request.channel)
    session_issue_state=issue_state_store.get(request.session_id,{})
    agent_summary=build_agent_case_summary(request,session_issue_state)

    ticket = {
        "ticket_id": ticket_id,
        "session_id": request.session_id,
        "conversation_id": request.conversation_id,
        "user_id": request.user_id,
        "customer_name": request.customer_name,
        "customer_email": str(request.customer_email) if request.customer_email else None,
        "customer_phone": normalize_phone_number(request.customer_phone),
        "reason": request.reason.strip(),
        "contact_preference": preference,
        "channel": normalized_channel,
        "ai_summary": agent_summary,
        "status": "waiting",
        "priority": determine_priority(request.reason, request.conversation),
        "conversation": [model_to_dict(item) for item in request.conversation],
        "created_at": now,
        "updated_at": now,
        "call_sid": None,
        "call_started_at": None,
        "crm_sync_status": "pending",
        "external_ticket_id": None,
    }

    crm_result=create_or_sync_crm_ticket(ticket)
    ticket["crm_sync_status"]="synced" if crm_result.get("synced") else crm_result.get("mode","internal")
    ticket["external_ticket_id"]=crm_result.get("external_ticket_id")

    with support_lock:
        tickets = read_json_list(SUPPORT_REQUESTS_FILE)
        tickets.insert(0, ticket)
        write_json_list(SUPPORT_REQUESTS_FILE, tickets)

    if request.customer_email:
        background_tasks.add_task(
            send_acknowledgement,
            str(request.customer_email),
            request.customer_name or "Customer",
            ticket_id,
            preference,
        )

    return {
        "message": "Your support request has been submitted for review.",
        "ticket_id": ticket_id,
        "request_id": ticket_id,
        "status": "waiting",
        "priority": ticket["priority"],
        "channel": normalized_channel,
        "crm_sync_status": ticket["crm_sync_status"],
        "callback_started": False,
    }


@app.get("/support/requests")
def list_support_requests(
    x_admin_key: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_admin_access(x_admin_key)
    tickets = read_json_list(SUPPORT_REQUESTS_FILE)
    return {"count": len(tickets), "requests": tickets}


@app.get("/support/requests/{ticket_id}")
def get_support_request(
    ticket_id: str,
    x_admin_key: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_admin_access(x_admin_key)
    tickets = read_json_list(SUPPORT_REQUESTS_FILE)
    ticket = next((t for t in tickets if t.get("ticket_id") == ticket_id), None)
    if not ticket:
        raise HTTPException(status_code=404, detail="Support request not found.")
    return ticket


@app.patch("/support/requests/{ticket_id}")
def update_support_request(
    ticket_id: str,
    request: SupportTicketUpdate,
    x_admin_key: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    verify_admin_access(x_admin_key)

    status = normalize_status(request.status)
    if status not in {"waiting", "reviewing", "resolved"}:
        raise HTTPException(status_code=400, detail="Invalid support status.")

    with support_lock:
        tickets = read_json_list(SUPPORT_REQUESTS_FILE)
        ticket = next((t for t in tickets if t.get("ticket_id") == ticket_id), None)
        if not ticket:
            raise HTTPException(status_code=404, detail="Support request not found.")

        ticket["status"] = status
        ticket["updated_at"] = datetime.now(timezone.utc).isoformat()
        write_json_list(SUPPORT_REQUESTS_FILE, tickets)

    return {
        "message": "Support request updated.",
        "ticket_id": ticket_id,
        "status": status,
        "request": ticket,
    }


# =============================================================================
# TWILIO AGENT-FIRST CALLBACK
# =============================================================================
@app.post("/support/requests/{ticket_id}/call")
def initiate_support_callback(
    ticket_id: str,
    x_admin_key: Optional[str] = Header(default=None),
) -> Dict[str, Any]:
    """
    Agent-controlled callback flow:

    1. Support agent clicks Call customer in support.html.
    2. Backend calls SUPPORT_AGENT_PHONE first.
    3. Agent answers.
    4. TwiML dials the customer's number and bridges both parties.

    The customer-facing application never invokes this endpoint directly.
    """
    verify_admin_access(x_admin_key)

    if not twilio_is_configured():
        raise HTTPException(status_code=503, detail="Calling service is not configured.")

    with support_lock:
        tickets = read_json_list(SUPPORT_REQUESTS_FILE)
        ticket = next((t for t in tickets if t.get("ticket_id") == ticket_id), None)

        if not ticket:
            raise HTTPException(status_code=404, detail="Support request not found.")

        if ticket.get("status") == "resolved":
            raise HTTPException(status_code=400, detail="Resolved tickets cannot be called.")

        if ticket.get("contact_preference") != "callback":
            raise HTTPException(status_code=400, detail="This customer did not request a callback.")

        customer_phone = normalize_phone_number(ticket.get("customer_phone"))

        if not valid_e164_phone(customer_phone):
            raise HTTPException(
                status_code=400,
                detail="The customer does not have a valid international-format phone number.",
            )

        if not valid_e164_phone(SUPPORT_AGENT_PHONE):
            raise HTTPException(status_code=500, detail="Support agent phone configuration is invalid.")

        try:
            client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

            # This TwiML is executed only after the SUPPORT AGENT answers.
            twiml = f"""
<Response>
  <Say>NexaTel support callback for ticket {escape_xml(ticket_id)}. Connecting you to the customer.</Say>
  <Dial callerId="{escape_xml(TWILIO_PHONE_NUMBER)}">
    <Number>{escape_xml(customer_phone)}</Number>
  </Dial>
</Response>
""".strip()

            call = client.calls.create(
                to=SUPPORT_AGENT_PHONE,
                from_=TWILIO_PHONE_NUMBER,
                twiml=twiml,
            )

            ticket["status"] = "reviewing"
            ticket["call_sid"] = call.sid
            ticket["call_started_at"] = datetime.now(timezone.utc).isoformat()
            ticket["updated_at"] = datetime.now(timezone.utc).isoformat()
            write_json_list(SUPPORT_REQUESTS_FILE, tickets)

            return {
                "message": "Support callback initiated.",
                "ticket_id": ticket_id,
                "status": "reviewing",
                "call_sid": call.sid,
            }

        except HTTPException:
            raise
        except Exception as error:
            print(f"[twilio] callback failed: {error!r}")
            raise HTTPException(
                status_code=503,
                detail="The call could not be started right now. Please try again shortly.",
            )


# =============================================================================
# STARTUP LOG
# =============================================================================
@app.on_event("startup")
def startup_message() -> None:
    print()
    print("=" * 78)
    print("NEXATEL AI TELECOM SUPPORT - BACKEND 7.1")
    print("=" * 78)
    print("Swagger: http://127.0.0.1:8000/docs")
    print(f"NVIDIA configured : {bool(OPENAI_COMPATIBLE_SDK_AVAILABLE and NVIDIA_API_KEY)}")
    print(f"NVIDIA chat model : {NVIDIA_CHAT_MODEL}")
    print(f"NVIDIA embed model: {NVIDIA_EMBEDDING_MODEL}")
    print(f"Gemini configured : {bool(GEMINI_SDK_AVAILABLE and GEMINI_API_KEY)}")
    print(f"Gemini model      : {GEMINI_MODEL}")
    print(f"OpenAI configured : {bool(OPENAI_COMPATIBLE_SDK_AVAILABLE and OPENAI_API_KEY)}")
    print(
        "Vector RAG ready   : "
        f"{bool((OPENAI_COMPATIBLE_SDK_AVAILABLE and NVIDIA_API_KEY) or SENTENCE_TRANSFORMERS_AVAILABLE)}"
    )
    print(f"Local RAG fallback : {bool(SENTENCE_TRANSFORMERS_AVAILABLE)}")
    print(f"FAISS available   : {FAISS_AVAILABLE}")
    print(f"SendGrid configured: {bool(SENDGRID_SDK_AVAILABLE and SENDGRID_API_KEY and SENDGRID_FROM_EMAIL)}")
    print(f"Twilio configured : {twilio_is_configured()}")
    print("Provider priority : NVIDIA -> Gemini -> OpenAI -> fallback")
    print("Channels          : chat + voice transcript pipeline")
    print(f"CRM connector     : {crm_is_configured()}")
    print("=" * 78)
    print()
