from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Body
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import AttendanceResponse, RecognitionResult, DashboardStats
from ..services import attendance_service

router = APIRouter(prefix="/attendance", tags=["Attendance"])

@router.post("/mark", response_model=RecognitionResult)
def mark_attendance_webcam(
    payload: dict = Body(..., openapi_examples={"default": {"value": {"image": "data:image/jpeg;base64,...", "session_name": "Daily"}}}),
    db: Session = Depends(get_db)
):
    """
    Recognizes face from a live webcam snapshot (base64 string).
    Enforces duplicate prevention: allows marking ONLY ONCE per session/day.
    Rejects unknown faces with threshold check.
    """
    image_base64 = payload.get("image")
    if not image_base64:
        raise HTTPException(status_code=400, detail="Missing 'image' base64 field in payload.")

    session_name = payload.get("session_name", "Daily")
    try:
        result = attendance_service.process_attendance(
            db=db,
            image_data=image_base64,
            session_name=session_name,
            method="webcam"
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process attendance: {str(e)}")

@router.post("/upload", response_model=RecognitionResult)
async def mark_attendance_upload(
    file: UploadFile = File(...),
    session_name: str = Form("Daily"),
    db: Session = Depends(get_db)
):
    """Fallback: recognize face and mark attendance from an uploaded image file."""
    try:
        content = await file.read()
        result = attendance_service.process_attendance(
            db=db,
            image_data=content,
            session_name=session_name,
            method="upload"
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process uploaded image: {str(e)}")

@router.get("", response_model=List[AttendanceResponse])
def get_attendance_records(
    date: Optional[str] = Query(None, description="Filter by date (YYYY-MM-DD)"),
    student_id: Optional[str] = Query(None, description="Filter by student ID"),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """Queries attendance records with optional date and student ID filters."""
    records = attendance_service.get_attendances(db, date_str=date, student_id=student_id, limit=limit)
    return [
        AttendanceResponse(
            id=r.id,
            student_id=r.student_id,
            student_name=r.student_name,
            date=r.date,
            time=r.time,
            timestamp=r.timestamp.isoformat() if r.timestamp else None,
            confidence_score=r.confidence_score,
            similarity_percentage=r.similarity_percentage,
            session_name=r.session_name,
            status=r.status,
            verification_method=r.verification_method
        )
        for r in records
    ]

@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    """Retrieves high-level KPI stats for dashboard overview."""
    return attendance_service.get_dashboard_stats(db)
