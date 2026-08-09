# ============================================================
# DATABASE.PY
# ============================================================
#
# PURPOSE:
# This file creates the connection between our FastAPI
# application and the Neon PostgreSQL database.
#
# Flow:
#
# FastAPI
#    ↓
# SQLAlchemy
#    ↓
# psycopg
#    ↓
# Neon PostgreSQL
#
# ============================================================


# ------------------------------------------------------------
# IMPORTS
# ------------------------------------------------------------

import os

# Loads variables stored inside our .env file.
from dotenv import load_dotenv

# create_engine creates the main database connection engine.
from sqlalchemy import create_engine

# SQLAlchemy ORM utilities.
from sqlalchemy.orm import (
    declarative_base,
    sessionmaker,
)


# ------------------------------------------------------------
# LOAD ENVIRONMENT VARIABLES
# ------------------------------------------------------------
#
# This loads values from:
#
# .env
#
# Example:
#
# DATABASE_URL=postgresql+psycopg://...
#

load_dotenv()


# ------------------------------------------------------------
# READ DATABASE URL
# ------------------------------------------------------------

DATABASE_URL = os.getenv(
    "DATABASE_URL"
)


# ------------------------------------------------------------
# CHECK DATABASE URL
# ------------------------------------------------------------
#
# If DATABASE_URL does not exist,
# stop the application.
#
# This prevents the app from starting without
# a database connection configured.
#

if not DATABASE_URL:

    raise ValueError(
        "DATABASE_URL is missing from the .env file"
    )


# ------------------------------------------------------------
# CREATE SQLALCHEMY ENGINE
# ------------------------------------------------------------
#
# Think of "engine" as the main bridge between:
#
# Python
# and
# PostgreSQL
#
# SQLAlchemy uses this engine whenever it needs
# to communicate with the database.
#

engine = create_engine(

    DATABASE_URL,

    # Before using an existing connection from the pool,
    # SQLAlchemy checks whether the connection is alive.
    #
    # This is useful with cloud databases such as Neon,
    # where idle connections may sometimes close.
    pool_pre_ping=True,
)


# ------------------------------------------------------------
# CREATE DATABASE SESSION FACTORY
# ------------------------------------------------------------
#
# SessionLocal is used to create database sessions.
#
# A database session allows us to:
#
# CREATE records
# READ records
# UPDATE records
# DELETE records
#
# This is often called CRUD:
#
# Create
# Read
# Update
# Delete
#

SessionLocal = sessionmaker(

    # We will manually commit database transactions.
    autocommit=False,

    # SQLAlchemy will not automatically flush changes.
    autoflush=False,

    # Connect this session factory to our database engine.
    bind=engine,
)


# ------------------------------------------------------------
# CREATE BASE CLASS
# ------------------------------------------------------------
#
# All our database table models will inherit from Base.
#
# Example:
#
# class SupportTicket(Base):
#
# SQLAlchemy uses Base to understand which Python
# classes represent database tables.
#

Base = declarative_base()


# ------------------------------------------------------------
# FASTAPI DATABASE DEPENDENCY
# ------------------------------------------------------------
#
# get_db() gives each FastAPI request its own
# database session.
#
# Example:
#
# Customer calls:
#
# POST /chat
#
# FastAPI
#    ↓
# get_db()
#    ↓
# opens database session
#    ↓
# performs database operations
#    ↓
# request finishes
#    ↓
# closes database session
#
# This prevents database connections from remaining
# open unnecessarily.
#

def get_db():

    # Create a new database session.
    db = SessionLocal()

    try:

        # Give the session to the FastAPI endpoint.
        yield db

    finally:

        # Always close the session when the request ends.
        db.close()