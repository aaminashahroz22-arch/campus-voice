"""Campus Voice API (FastAPI + SQLAlchemy).

Run:  pip install fastapi uvicorn sqlalchemy pydantic
      uvicorn main:app --reload

Uses SQLite by default; set DATABASE_URL to a PostgreSQL URL for production
(e.g. postgresql+psycopg://user:pass@host/campusvoice).
"""
import math
import os
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import (Column, DateTime, Enum as SAEnum, ForeignKey, Integer,
                        String, Text, UniqueConstraint, create_engine, func)
from sqlalchemy.orm import Session, declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./campusvoice.db")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "change-me")  # replace with real auth (JWT/SSO) in production

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Status(str, Enum):
    open = "Open"
    in_progress = "In Progress"
    resolved = "Resolved"


class Priority(str, Enum):
    low = "Low"
    medium = "Medium"
    critical = "Critical"


class IssueRow(Base):
    __tablename__ = "issues"
    id = Column(Integer, primary_key=True)
    title = Column(String(140), nullable=False)
    category = Column(String(40), nullable=False, index=True)
    location = Column(String(120), nullable=False)
    description = Column(Text, default="")
    priority = Column(SAEnum(Priority), default=Priority.medium, nullable=False)
    status = Column(SAEnum(Status), default=Status.open, nullable=False, index=True)
    image_url = Column(String(500))
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    resolved_at = Column(DateTime(timezone=True))


class UpvoteRow(Base):
    __tablename__ = "upvotes"
    id = Column(Integer, primary_key=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    voter_id = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    __table_args__ = (UniqueConstraint("issue_id", "voter_id", name="uq_one_vote_per_voter"),)


Base.metadata.create_all(engine)


# ---------- Schemas ----------
class IssueIn(BaseModel):
    title: str = Field(min_length=5, max_length=140)
    category: str = Field(max_length=40)
    location: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)
    priority: Priority = Priority.medium
    image_url: Optional[str] = None


class IssueOut(BaseModel):
    id: int
    title: str
    category: str
    location: str
    description: str
    priority: Priority
    status: Status
    upvotes: int
    recent_upvotes: int
    trending_score: float
    created_at: datetime
    resolved_at: Optional[datetime]


class StatusIn(BaseModel):
    status: Status


class StatsOut(BaseModel):
    total_issues: int
    resolved_today: int
    avg_resolution_hours: float


# ---------- App ----------
app = FastAPI(title="Campus Voice API")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
                   allow_methods=["*"], allow_headers=["*"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_admin(x_admin_token: str = Header(default="")):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Admin access required")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _serialize(db: Session, row: IssueRow) -> IssueOut:
    total = db.query(func.count(UpvoteRow.id)).filter(UpvoteRow.issue_id == row.id).scalar() or 0
    recent = (db.query(func.count(UpvoteRow.id))
              .filter(UpvoteRow.issue_id == row.id, UpvoteRow.created_at >= utcnow() - timedelta(hours=24))
              .scalar() or 0)
    age_h = (utcnow() - _aware(row.created_at)).total_seconds() / 3600
    # Upvote velocity: recent votes per sqrt(age) so fast-rising issues outrank old, slow ones.
    score = (recent + 1) / math.sqrt(age_h + 2)
    return IssueOut(id=row.id, title=row.title, category=row.category, location=row.location,
                    description=row.description or "", priority=row.priority, status=row.status,
                    upvotes=total, recent_upvotes=recent, trending_score=round(score, 4),
                    created_at=row.created_at, resolved_at=row.resolved_at)


# ---------- Endpoints ----------
@app.get("/issues", response_model=list[IssueOut])
def list_issues(
    status: Optional[Status] = None,
    category: Optional[str] = None,
    location_prefix: Optional[str] = Query(None, description="e.g. 'Block B' for the Near Me tab"),
    sort: str = Query("trending", pattern="^(trending|new)$"),
    db: Session = Depends(get_db),
):
    q = db.query(IssueRow)
    if status:
        q = q.filter(IssueRow.status == status)
    if category:
        q = q.filter(IssueRow.category == category)
    if location_prefix:
        q = q.filter(IssueRow.location.ilike(f"{location_prefix}%"))
    items = [_serialize(db, r) for r in q.all()]
    items.sort(key=(lambda i: i.trending_score) if sort == "trending" else (lambda i: i.created_at), reverse=True)
    return items


@app.post("/issues", response_model=IssueOut, status_code=201)
def create_issue(body: IssueIn, x_voter_id: str = Header(default="anon"), db: Session = Depends(get_db)):
    row = IssueRow(**body.model_dump())
    db.add(row)
    db.flush()
    db.add(UpvoteRow(issue_id=row.id, voter_id=x_voter_id))  # reporter counts as first affected user
    db.commit()
    db.refresh(row)
    return _serialize(db, row)


@app.post("/upvote/{issue_id}", response_model=IssueOut)
def upvote(issue_id: int, x_voter_id: str = Header(..., min_length=8), db: Session = Depends(get_db)):
    row = db.get(IssueRow, issue_id)
    if not row:
        raise HTTPException(404, "Issue not found")
    exists = db.query(UpvoteRow).filter_by(issue_id=issue_id, voter_id=x_voter_id).first()
    if exists:
        raise HTTPException(409, "You've already confirmed this issue")
    db.add(UpvoteRow(issue_id=issue_id, voter_id=x_voter_id))
    db.commit()
    return _serialize(db, row)


@app.patch("/status/{issue_id}", response_model=IssueOut, dependencies=[Depends(require_admin)])
def set_status(issue_id: int, body: StatusIn, db: Session = Depends(get_db)):
    row = db.get(IssueRow, issue_id)
    if not row:
        raise HTTPException(404, "Issue not found")
    row.status = body.status
    row.resolved_at = utcnow() if body.status == Status.resolved else None
    db.commit()
    return _serialize(db, row)


@app.get("/stats", response_model=StatsOut, dependencies=[Depends(require_admin)])
def stats(db: Session = Depends(get_db)):
    total = db.query(func.count(IssueRow.id)).scalar() or 0
    resolved = db.query(IssueRow).filter(IssueRow.resolved_at.isnot(None)).all()
    today = utcnow() - timedelta(hours=24)
    resolved_today = sum(1 for r in resolved if _aware(r.resolved_at) >= today)
    hours = [(_aware(r.resolved_at) - _aware(r.created_at)).total_seconds() / 3600 for r in resolved]
    return StatsOut(total_issues=total, resolved_today=resolved_today,
                    avg_resolution_hours=round(sum(hours) / len(hours), 1) if hours else 0.0)
