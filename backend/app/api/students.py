from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Body
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import StudentCreate, StudentResponse
from ..services import attendance_service
from ..face_engine import face_engine

router = APIRouter(prefix="/students", tags=["Students"])

@router.post("", response_model=StudentResponse, status_code=201)
def register_student(student_data: StudentCreate, db: Session = Depends(get_db)):
    """Registers a new student record."""
    try:
        student = attendance_service.create_student(db, student_data)
        return student
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to register student: {str(e)}")

@router.get("", response_model=List[StudentResponse])
def list_students(db: Session = Depends(get_db)):
    """Retrieves all registered students."""
    students = attendance_service.get_all_students(db)
    return students

@router.get("/{student_id}", response_model=StudentResponse)
def get_student(student_id: str, db: Session = Depends(get_db)):
    """Retrieves a single student by student_id."""
    student = attendance_service.get_student(db, student_id)
    if not student:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    return student

@router.post("/{student_id}/samples")
def upload_student_samples_base64(
    student_id: str,
    payload: dict = Body(..., openapi_examples={"default": {"value": {"images": ["data:image/jpeg;base64,..."]}}}),
    db: Session = Depends(get_db)
):
    """
    Uploads multiple base64-encoded face capture frames directly from webcam.
    Detects faces, equalizes histograms, standardizes sizes, and saves samples.
    """
    images = payload.get("images", [])
    if not images or not isinstance(images, list):
        raise HTTPException(status_code=400, detail="Expected a non-empty 'images' list of base64 strings.")

    try:
        success, failed = attendance_service.add_face_samples(db, student_id, images)
        return {
            "student_id": student_id,
            "samples_added": success,
            "samples_failed": failed,
            "total_samples": face_engine.get_student_sample_count(student_id),
            "message": f"Processed {len(images)} images: {success} face samples extracted and saved successfully."
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process face samples: {str(e)}")

@router.post("/{student_id}/upload-files")
async def upload_student_samples_files(
    student_id: str,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    """Fallback: upload multiple face image files directly."""
    student = attendance_service.get_student(db, student_id)
    if not student:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")

    success_count = 0
    fail_count = 0

    for file in files:
        try:
            content = await file.read()
            bgr_img = face_engine.decode_bytes_image(content)
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

    return {
        "student_id": student_id,
        "samples_added": success_count,
        "samples_failed": fail_count,
        "total_samples": total_saved,
        "message": f"Uploaded {len(files)} files: {success_count} faces extracted successfully."
    }

@router.delete("/{student_id}")
def delete_student(student_id: str, db: Session = Depends(get_db)):
    """Deletes student record, attendance history, and saved face samples."""
    deleted = attendance_service.delete_student(db, student_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    return {"message": f"Student '{student_id}' and all associated face data deleted successfully."}
