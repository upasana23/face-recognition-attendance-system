from typing import List, Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import StudentStats
from ..services import attendance_service

router = APIRouter(prefix="/reports", tags=["Reports & Analytics"])

@router.get("/analytics", response_model=List[StudentStats])
def get_student_analytics(db: Session = Depends(get_db)):
    """Computes student-level attendance rates, total sessions attended, and last attended date."""
    try:
        analytics = attendance_service.get_student_analytics(db)
        return analytics
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate analytics: {str(e)}")

@router.get("/export/csv")
def export_attendance_csv(
    date: Optional[str] = Query(None, description="Export specific date (YYYY-MM-DD)"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db)
):
    """Generates and downloads a CSV attendance report."""
    try:
        csv_path = attendance_service.generate_csv_report(
            db, date_str=date, start_date=start_date, end_date=end_date
        )
        file_name = Path(csv_path).name
        return FileResponse(
            path=csv_path,
            filename=file_name,
            media_type="text/csv"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export CSV: {str(e)}")
