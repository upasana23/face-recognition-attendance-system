import sys
import io
from pathlib import Path
from datetime import datetime, timedelta
import random

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from backend.app.database import SessionLocal, init_db
from backend.app.models import Student, Attendance, TrainingLog

def seed_demo_data():
    print("[Seed] Initializing database tables...")
    init_db()
    db = SessionLocal()

    demo_students = [
        {"student_id": "STU-1001", "name": "Elena Rostova", "department": "Computer Science", "email": "elena.r@university.edu"},
        {"student_id": "STU-1002", "name": "Marcus Vance", "department": "Data Science", "email": "marcus.v@university.edu"},
        {"student_id": "STU-1003", "name": "Amina Al-Mansoor", "department": "Artificial Intelligence", "email": "amina.a@university.edu"},
        {"student_id": "STU-1004", "name": "David Chen", "department": "Computer Science", "email": "david.c@university.edu"},
        {"student_id": "STU-1005", "name": "Sophia Rodriguez", "department": "Software Engineering", "email": "sophia.r@university.edu"}
    ]

    print("[Seed] Seeding demo students...")
    created_students = []
    for s_data in demo_students:
        existing = db.query(Student).filter(Student.student_id == s_data["student_id"]).first()
        if not existing:
            student = Student(
                student_id=s_data["student_id"],
                name=s_data["name"],
                department=s_data["department"],
                email=s_data["email"],
                image_count=15
            )
            db.add(student)
            created_students.append(student)
        else:
            created_students.append(existing)
    db.commit()

    print("[Seed] Seeding historical attendance logs...")
    today = datetime.now()
    dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(5, -1, -1)]

    for d in dates:
        for student in created_students:
            # 80% chance of attendance
            if random.random() < 0.8:
                existing_att = db.query(Attendance).filter(
                    Attendance.student_id == student.student_id,
                    Attendance.date == d,
                    Attendance.session_name == "Daily"
                ).first()
                if not existing_att:
                    hour = random.randint(8, 10)
                    minute = random.randint(0, 59)
                    second = random.randint(0, 59)
                    confidence = round(random.uniform(42.0, 68.0), 2)
                    similarity = round((1.0 - (confidence / 100.0)) * 100.0, 1)

                    att = Attendance(
                        student_id=student.student_id,
                        student_name=student.name,
                        date=d,
                        time=f"{hour:02d}:{minute:02d}:{second:02d}",
                        confidence_score=confidence,
                        similarity_percentage=similarity,
                        session_name="Daily",
                        status="Present",
                        verification_method="webcam"
                    )
                    db.add(att)
    db.commit()

    # Seed training log
    existing_log = db.query(TrainingLog).first()
    if not existing_log:
        log = TrainingLog(
            total_students=len(demo_students),
            total_samples=len(demo_students) * 15,
            duration_seconds=1.42,
            status="success",
            message="Initial demo model setup log."
        )
        db.add(log)
        db.commit()

    db.close()
    print("[Seed] Demo data seeded successfully! 5 students and past attendance records are ready.")

if __name__ == "__main__":
    seed_demo_data()
