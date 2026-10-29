from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base

def utc_now():
    return datetime.now(timezone.utc)

class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(128), nullable=False)
    department = Column(String(128), default="General")
    email = Column(String(128), nullable=True)
    image_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)
    is_active = Column(Boolean, default=True)

    # Relationships
    attendances = relationship("Attendance", back_populates="student", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "name": self.name,
            "department": self.department,
            "email": self.email,
            "image_count": self.image_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "is_active": self.is_active,
        }

class Attendance(Base):
    __tablename__ = "attendances"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(64), ForeignKey("students.student_id", ondelete="CASCADE"), index=True, nullable=False)
    student_name = Column(String(128), nullable=False)
    date = Column(String(10), index=True, nullable=False)  # Format: YYYY-MM-DD
    time = Column(String(8), nullable=False)               # Format: HH:MM:SS
    timestamp = Column(DateTime, default=utc_now, index=True)
    confidence_score = Column(Float, nullable=True)        # LBPH distance (lower is better)
    similarity_percentage = Column(Float, nullable=True)   # Calculated 0-100%
    session_name = Column(String(64), default="Daily")
    status = Column(String(32), default="Present")
    verification_method = Column(String(32), default="webcam") # webcam | upload

    # Duplicate prevention constraint: (student_id, date, session_name)
    __table_args__ = (
        UniqueConstraint("student_id", "date", "session_name", name="uix_student_date_session"),
    )

    student = relationship("Student", back_populates="attendances")

    def to_dict(self):
        return {
            "id": self.id,
            "student_id": self.student_id,
            "student_name": self.student_name,
            "date": self.date,
            "time": self.time,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "confidence_score": self.confidence_score,
            "similarity_percentage": self.similarity_percentage,
            "session_name": self.session_name,
            "status": self.status,
            "verification_method": self.verification_method,
        }

class TrainingLog(Base):
    __tablename__ = "training_logs"

    id = Column(Integer, primary_key=True, index=True)
    trained_at = Column(DateTime, default=utc_now)
    total_students = Column(Integer, default=0)
    total_samples = Column(Integer, default=0)
    duration_seconds = Column(Float, default=0.0)
    status = Column(String(32), default="success")
    message = Column(String(256), default="")

    def to_dict(self):
        return {
            "id": self.id,
            "trained_at": self.trained_at.isoformat() if self.trained_at else None,
            "total_students": self.total_students,
            "total_samples": self.total_samples,
            "duration_seconds": self.duration_seconds,
            "status": self.status,
            "message": self.message,
        }
