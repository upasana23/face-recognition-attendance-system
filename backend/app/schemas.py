from typing import Optional, List
from pydantic import BaseModel, Field

class StudentCreate(BaseModel):
    student_id: str = Field(..., min_length=2, max_length=64, description="Unique student identification code")
    name: str = Field(..., min_length=2, max_length=128, description="Student's full name")
    department: Optional[str] = Field(default="General", max_length=128)
    email: Optional[str] = Field(default=None, max_length=128)

class StudentResponse(BaseModel):
    id: int
    student_id: str
    name: str
    department: Optional[str]
    email: Optional[str]
    image_count: int
    created_at: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True

class AttendanceCreate(BaseModel):
    image_base64: Optional[str] = None
    session_name: Optional[str] = "Daily"
    verification_method: Optional[str] = "webcam"

class AttendanceResponse(BaseModel):
    id: int
    student_id: str
    student_name: str
    date: str
    time: str
    timestamp: Optional[str]
    confidence_score: Optional[float]
    similarity_percentage: Optional[float]
    session_name: str
    status: str
    verification_method: str

    class Config:
        from_attributes = True

class RecognitionResult(BaseModel):
    recognized: bool
    status: str  # "marked_present", "already_marked", "unknown_face", "no_face_detected"
    message: str
    student_id: Optional[str] = None
    student_name: Optional[str] = None
    confidence_score: Optional[float] = None
    similarity_percentage: Optional[float] = None
    attendance_record: Optional[AttendanceResponse] = None
    bounding_box: Optional[List[int]] = None  # [x, y, w, h]

class TrainingResponse(BaseModel):
    success: bool
    message: str
    total_students: int
    total_samples: int
    duration_seconds: float

class DailySummary(BaseModel):
    date: str
    total_present: int
    total_registered: int
    attendance_rate: float
    records: List[AttendanceResponse]

class StudentStats(BaseModel):
    student_id: str
    name: str
    department: str
    total_days_present: int
    total_sessions_active: int
    attendance_rate: float
    last_attended: Optional[str]

class DashboardStats(BaseModel):
    total_registered_students: int
    today_attendance_count: int
    today_attendance_rate: float
    model_trained: bool
    last_trained_at: Optional[str]
    recent_attendances: List[AttendanceResponse]
