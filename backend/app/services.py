import os
from datetime import datetime, date, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from .models import Student, Attendance, TrainingLog
from .schemas import StudentCreate, RecognitionResult, AttendanceResponse, StudentStats, DashboardStats
from .face_engine import face_engine
from .config import settings

class AttendanceService:
    @staticmethod
    def create_student(db: Session, student_data: StudentCreate) -> Student:
        existing = db.query(Student).filter(Student.student_id == student_data.student_id.strip()).first()
        if existing:
            raise ValueError(f"Student with ID '{student_data.student_id}' is already registered.")
        
        student = Student(
            student_id=student_data.student_id.strip(),
            name=student_data.name.strip(),
            department=student_data.department.strip() if student_data.department else "General",
            email=student_data.email.strip() if student_data.email else None,
            image_count=0
        )
        db.add(student)
        db.commit()
        db.refresh(student)
        return student

    @staticmethod
    def get_all_students(db: Session) -> List[Student]:
        return db.query(Student).order_by(Student.created_at.desc()).all()

    @staticmethod
    def get_student(db: Session, student_id: str) -> Optional[Student]:
        return db.query(Student).filter(Student.student_id == student_id).first()

    @staticmethod
    def delete_student(db: Session, student_id: str) -> bool:
        student = db.query(Student).filter(Student.student_id == student_id).first()
        if not student:
            return False
        
        # Delete dataset files for this student
        student_dir = Path(settings.DATASET_DIR) / student_id
        if student_dir.exists():
            for f in student_dir.glob("*"):
                f.unlink(missing_ok=True)
            student_dir.rmdir()
            
        db.delete(student)
        db.commit()
        return True

    @staticmethod
    def add_face_samples(db: Session, student_id: str, image_base64_list: List[str]) -> Tuple[int, int]:
        """
        Processes list of base64 images, detects faces, saves valid samples,
        and updates student image count. Returns (successful_samples, failed_samples).
        """
        student = db.query(Student).filter(Student.student_id == student_id).first()
        if not student:
            raise ValueError(f"Student '{student_id}' does not exist.")

        success_count = 0
        fail_count = 0

        for b64_str in image_base64_list:
            try:
                bgr_img = face_engine.decode_base64_image(b64_str)
                saved = face_engine.save_student_sample(student_id, bgr_img)
                if saved:
                    success_count += 1
                else:
                    fail_count += 1
            except Exception:
                fail_count += 1

        total_saved = face_engine.get_student_sample_count(student_id)
        student.image_count = total_saved
        db.commit()
        db.refresh(student)
        return success_count, fail_count

    @staticmethod
    def train_face_model(db: Session) -> Dict[str, Any]:
        """Trains LBPH face recognizer model and logs results."""
        try:
            result = face_engine.train_model()
            log = TrainingLog(
                total_students=result["total_students"],
                total_samples=result["total_samples"],
                duration_seconds=result["duration_seconds"],
                status="success",
                message=result["message"]
            )
            db.add(log)
            db.commit()
            return result
        except Exception as e:
            log = TrainingLog(
                total_students=0,
                total_samples=0,
                duration_seconds=0.0,
                status="failed",
                message=str(e)
            )
            db.add(log)
            db.commit()
            raise

    @staticmethod
    def process_attendance(
        db: Session,
        image_data: str | bytes,
        session_name: str = "Daily",
        method: str = "webcam"
    ) -> RecognitionResult:
        """
        Recognizes student from webcam/image and enforces duplicate prevention:
        A student can be marked present ONLY ONCE per session/day.
        """
        # Decode image
        if isinstance(image_data, str):
            image = face_engine.decode_base64_image(image_data)
        else:
            image = face_engine.decode_bytes_image(image_data)

        # Run face recognition engine
        pred = face_engine.predict_face(image)

        if not pred.get("recognized"):
            return RecognitionResult(
                recognized=False,
                status=pred.get("status", "unknown_face"),
                message=pred.get("message", "Face not recognized."),
                student_id=None,
                student_name=None,
                confidence_score=pred.get("confidence_score"),
                similarity_percentage=pred.get("similarity_percentage"),
                attendance_record=None,
                bounding_box=pred.get("bounding_box")
            )

        student_id = pred["student_id"]
        student = db.query(Student).filter(Student.student_id == student_id).first()
        student_name = student.name if student else student_id

        # Current date and time
        now = datetime.now()
        current_date = now.strftime("%Y-%m-%d")
        current_time = now.strftime("%H:%M:%S")

        # Duplicate Prevention Check: (student_id, date, session_name)
        existing_record = db.query(Attendance).filter(
            Attendance.student_id == student_id,
            Attendance.date == current_date,
            Attendance.session_name == session_name
        ).first()

        if existing_record:
            return RecognitionResult(
                recognized=True,
                status="already_marked",
                message=f"{student_name} ({student_id}) has ALREADY been marked present today at {existing_record.time} ({existing_record.session_name}).",
                student_id=student_id,
                student_name=student_name,
                confidence_score=pred["confidence_score"],
                similarity_percentage=pred["similarity_percentage"],
                attendance_record=AttendanceResponse(
                    id=existing_record.id,
                    student_id=existing_record.student_id,
                    student_name=existing_record.student_name,
                    date=existing_record.date,
                    time=existing_record.time,
                    timestamp=existing_record.timestamp.isoformat() if existing_record.timestamp else None,
                    confidence_score=existing_record.confidence_score,
                    similarity_percentage=existing_record.similarity_percentage,
                    session_name=existing_record.session_name,
                    status=existing_record.status,
                    verification_method=existing_record.verification_method
                ),
                bounding_box=pred.get("bounding_box")
            )

        # Mark new attendance record
        new_record = Attendance(
            student_id=student_id,
            student_name=student_name,
            date=current_date,
            time=current_time,
            confidence_score=pred["confidence_score"],
            similarity_percentage=pred["similarity_percentage"],
            session_name=session_name,
            status="Present",
            verification_method=method
        )
        db.add(new_record)
        db.commit()
        db.refresh(new_record)

        return RecognitionResult(
            recognized=True,
            status="marked_present",
            message=f"Attendance marked successfully for {student_name} ({student_id}) at {current_time}.",
            student_id=student_id,
            student_name=student_name,
            confidence_score=pred["confidence_score"],
            similarity_percentage=pred["similarity_percentage"],
            attendance_record=AttendanceResponse(
                id=new_record.id,
                student_id=new_record.student_id,
                student_name=new_record.student_name,
                date=new_record.date,
                time=new_record.time,
                timestamp=new_record.timestamp.isoformat() if new_record.timestamp else None,
                confidence_score=new_record.confidence_score,
                similarity_percentage=new_record.similarity_percentage,
                session_name=new_record.session_name,
                status=new_record.status,
                verification_method=new_record.verification_method
            ),
            bounding_box=pred.get("bounding_box")
        )

    @staticmethod
    def get_attendances(
        db: Session,
        date_str: Optional[str] = None,
        student_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Attendance]:
        query = db.query(Attendance)
        if date_str:
            query = query.filter(Attendance.date == date_str)
        if student_id:
            query = query.filter(Attendance.student_id == student_id)
        return query.order_by(desc(Attendance.timestamp)).limit(limit).all()

    @staticmethod
    def get_dashboard_stats(db: Session) -> DashboardStats:
        total_students = db.query(Student).count()
        today = datetime.now().strftime("%Y-%m-%d")
        
        today_attendance_count = db.query(Attendance).filter(Attendance.date == today).count()
        today_rate = round((today_attendance_count / total_students * 100.0), 1) if total_students > 0 else 0.0

        last_train_log = db.query(TrainingLog).order_by(desc(TrainingLog.trained_at)).first()
        last_trained_str = last_train_log.trained_at.strftime("%Y-%m-%d %H:%M:%S") if last_train_log else None

        recent = db.query(Attendance).order_by(desc(Attendance.timestamp)).limit(10).all()
        recent_list = [
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
            for r in recent
        ]

        return DashboardStats(
            total_registered_students=total_students,
            today_attendance_count=today_attendance_count,
            today_attendance_rate=today_rate,
            model_trained=face_engine.is_model_loaded(),
            last_trained_at=last_trained_str,
            recent_attendances=recent_list
        )

    @staticmethod
    def get_student_analytics(db: Session) -> List[StudentStats]:
        """Calculates attendance percentages for each registered student."""
        students = db.query(Student).all()
        # Count total distinct dates attendance was taken
        distinct_dates_count = db.query(func.count(func.distinct(Attendance.date))).scalar() or 1
        
        stats_list = []
        for s in students:
            days_present = db.query(Attendance).filter(Attendance.student_id == s.student_id).count()
            rate = round((days_present / distinct_dates_count * 100.0), 1) if distinct_dates_count > 0 else 0.0
            
            last_att = db.query(Attendance).filter(
                Attendance.student_id == s.student_id
            ).order_by(desc(Attendance.timestamp)).first()
            
            last_str = f"{last_att.date} {last_att.time}" if last_att else "Never"

            stats_list.append(StudentStats(
                student_id=s.student_id,
                name=s.name,
                department=s.department or "General",
                total_days_present=days_present,
                total_sessions_active=distinct_dates_count,
                attendance_rate=min(100.0, rate),
                last_attended=last_str
            ))
        return stats_list

    @staticmethod
    def generate_csv_report(
        db: Session,
        date_str: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> str:
        """Generates a downloadable CSV report of attendance records using Pandas."""
        query = db.query(Attendance)
        if date_str:
            query = query.filter(Attendance.date == date_str)
            filename = f"attendance_report_{date_str}.csv"
        elif start_date and end_date:
            query = query.filter(Attendance.date >= start_date, Attendance.date <= end_date)
            filename = f"attendance_report_{start_date}_to_{end_date}.csv"
        else:
            filename = f"attendance_report_all_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

        records = query.order_by(Attendance.date.desc(), Attendance.time.desc()).all()

        data = []
        for r in records:
            data.append({
                "Student ID": r.student_id,
                "Student Name": r.student_name,
                "Date": r.date,
                "Time": r.time,
                "Session": r.session_name,
                "Status": r.status,
                "Similarity %": f"{r.similarity_percentage}%" if r.similarity_percentage else "N/A",
                "Confidence (LBPH)": r.confidence_score if r.confidence_score else "N/A",
                "Method": r.verification_method
            })

        df = pd.DataFrame(data)
        if df.empty:
            df = pd.DataFrame(columns=[
                "Student ID", "Student Name", "Date", "Time", "Session", "Status", "Similarity %", "Confidence (LBPH)", "Method"
            ])

        export_path = Path(settings.EXPORTS_DIR) / filename
        df.to_csv(export_path, index=False, encoding="utf-8")
        return str(export_path)

attendance_service = AttendanceService()
