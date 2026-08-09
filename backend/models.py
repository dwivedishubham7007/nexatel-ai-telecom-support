# ============================================================
# MODELS.PY
# ============================================================
#
# PURPOSE:
#
# This file defines the PostgreSQL database tables used by
# our telecom support application.
#
#
# IMPORTANT CONCEPT:
#
# SQLAlchemy ORM allows us to represent database tables
# using Python classes.
#
# Example:
#
# Python:
#
#     SupportTicket(...)
#
# becomes:
#
# PostgreSQL row inside:
#
#     support_tickets
#
#
# We now separate:
#
# USER
# CONVERSATION
# MESSAGE
# TICKET
# TICKET STATE
# RESPONSE CACHE
#
# because these are different business concepts.
#
# ============================================================


# ============================================================
# IMPORTS
# ============================================================

from datetime import datetime


from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)


from sqlalchemy.orm import (
    Mapped,
    mapped_column,
)


from database import Base



# ============================================================
# USER
# ============================================================
#
# Represents either:
#
# 1. Guest visitor
#
# or
#
# 2. Demo signed-in user
#
#
# Examples:
#
# Guest:
#
# GST-A891BC2D
#
#
# Signed-in demo user:
#
# USR-A31F94D2
#
#
# IMPORTANT:
#
# Our current "login" will only be a prototype identity
# system.
#
# It is NOT secure authentication yet.
#
# Proper production authentication would use something like:
#
# OAuth
# JWT
# Auth0
# Cognito
# Clerk
# Supabase Auth
#
# ============================================================

class AppUser(Base):

    __tablename__ = "app_users"


    # Internal PostgreSQL numeric ID.

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )


    # Application-level user identifier.

    user_id: Mapped[str] = mapped_column(
        String(80),
        unique=True,
        index=True,
        nullable=False,
    )


    # Display name.
    #
    # Guest users may simply use:
    #
    # Guest User

    name: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        default="Guest User",
    )


    # Email is optional because guests do not need one.

    email: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=True,
    )


    # True:
    #
    # visitor is using guest mode.
    #
    # False:
    #
    # visitor used our demo sign-in flow.

    is_guest: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )


    # When this user identity was created.

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )



# ============================================================
# CONVERSATION
# ============================================================
#
# A user can have many conversations.
#
#
# USER
#   │
#   ├── Conversation 1
#   ├── Conversation 2
#   └── Conversation 3
#
#
# A conversation is NOT the same thing as a ticket.
#
# Example:
#
# Conversation:
#
# "Mobile internet issue"
#
#
# Ticket:
#
# TKT-A891BC23
#
#
# Several messages belong to the conversation while the
# ticket represents the support case.
#
# ============================================================

class Conversation(Base):

    __tablename__ = "conversations"


    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )


    # Example:
    #
    # CONV-A891BC23

    conversation_id: Mapped[str] = mapped_column(
        String(80),
        unique=True,
        index=True,
        nullable=False,
    )


    # Which user owns this conversation.

    user_id: Mapped[str] = mapped_column(
        String(80),
        index=True,
        nullable=False,
    )


    # Human-readable title shown in recent conversations.
    #
    # Example:
    #
    # Mobile internet issue

    title: Mapped[str] = mapped_column(
        String(180),
        default="New support conversation",
        nullable=False,
    )


    # Main category detected for the conversation.
    #
    # Example:
    #
    # Network
    # Billing
    # SIM

    category: Mapped[str | None] = mapped_column(
        String(50),
        index=True,
        nullable=True,
    )


    # Possible status examples:
    #
    # active
    # resolved_ai
    # escalated
    # closed

    status: Mapped[str] = mapped_column(
        String(40),
        default="active",
        index=True,
        nullable=False,
    )


    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )


    # We manually update this whenever a new message arrives.
    #
    # This lets us sort recent conversations correctly.

    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )



# ============================================================
# CONVERSATION MESSAGE
# ============================================================
#
# Stores every message permanently.
#
#
# Previously:
#
# conversation_history = {}
#
# existed only in Python memory.
#
#
# Problem:
#
# FastAPI restart
#     ↓
# chat disappears
#
#
# Now:
#
# Browser closes
# FastAPI restarts
# User visits another page
#
#     ↓
#
# messages remain in PostgreSQL.
#
# ============================================================

class ConversationMessage(Base):

    __tablename__ = "conversation_messages"


    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )


    # Unique message ID.

    message_id: Mapped[str] = mapped_column(
        String(80),
        unique=True,
        index=True,
        nullable=False,
    )


    # Which conversation contains this message.

    conversation_id: Mapped[str] = mapped_column(
        String(80),
        index=True,
        nullable=False,
    )


    # Either:
    #
    # user
    #
    # or
    #
    # assistant

    role: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )


    # Actual message text.

    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )


    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )



# ============================================================
# SUPPORT TICKET
# ============================================================
#
# This remains compatible with the ticket model we have
# already been using.
#
# ============================================================

class SupportTicket(Base):

    __tablename__ = "support_tickets"


    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )


    ticket_id: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        index=True,
        nullable=False,
    )


    # IMPORTANT:
    #
    # We now store conversation_id inside session_id.
    #
    # This preserves compatibility with your existing table
    # while allowing conversations to be persistent.

    session_id: Mapped[str] = mapped_column(
        String(100),
        index=True,
        nullable=False,
    )


    # Original issue that created the ticket.

    message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )


    # Most recent support response.

    reply: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )


    category: Mapped[str] = mapped_column(
        String(50),
        index=True,
        nullable=False,
    )


    priority: Mapped[str] = mapped_column(
        String(20),
        index=True,
        nullable=False,
    )


    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )


    escalated: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
        nullable=False,
    )


    escalation_reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )


    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )



# ============================================================
# TICKET STATE
# ============================================================
#
# Our existing support_tickets table did not originally have
# a ticket status column.
#
# Instead of changing that existing Neon table immediately,
# we keep operational state in a separate table.
#
#
# Example:
#
# TKT-A891BC23
#
# status = ai_handling
#
#
# Later:
#
# status = escalated
#
#
# or:
#
# status = resolved
#
# ============================================================

class TicketState(Base):

    __tablename__ = "ticket_states"


    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )


    ticket_id: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        index=True,
        nullable=False,
    )


    # Conversation currently associated with the ticket.

    conversation_id: Mapped[str] = mapped_column(
        String(80),
        index=True,
        nullable=False,
    )


    # Owner of ticket.

    user_id: Mapped[str] = mapped_column(
        String(80),
        index=True,
        nullable=False,
    )


    # Possible values:
    #
    # ai_handling
    # escalated
    # resolved
    # closed

    status: Mapped[str] = mapped_column(
        String(40),
        default="ai_handling",
        index=True,
        nullable=False,
    )


    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )



# ============================================================
# RESPONSE CACHE
# ============================================================
#
# PURPOSE:
#
# Avoid repeatedly calling an LLM for the same safe,
# generic support question from the same customer.
#
#
# Example:
#
# Customer asks:
#
# "How do I fix mobile data?"
#
# First time:
#
# LLM generates answer
#
#     ↓
#
# answer stored in cache
#
#
# Same customer asks exactly the same normalized question:
#
#     ↓
#
# cached answer returned
#
#
# Benefits:
#
# faster
# cheaper
# fewer API calls
#
#
# IMPORTANT:
#
# We intentionally do NOT cache sensitive/account-specific
# questions such as billing disputes.
#
# ============================================================

class ResponseCache(Base):

    __tablename__ = "response_cache"


    # Prevent duplicate cache entries for:
    #
    # same user
    # same category
    # same normalized query

    __table_args__ = (

        UniqueConstraint(
            "user_id",
            "category",
            "normalized_query",
            name="uq_user_category_query",
        ),

    )


    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )


    user_id: Mapped[str] = mapped_column(
        String(80),
        index=True,
        nullable=False,
    )


    category: Mapped[str] = mapped_column(
        String(50),
        index=True,
        nullable=False,
    )


    normalized_query: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )


    response: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )


    # Number of times cached answer has been reused.

    hit_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )


    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )


    last_used_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )