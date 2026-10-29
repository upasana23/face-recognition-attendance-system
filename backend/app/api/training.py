from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc

from ..database import get_db
from ..schemas import TrainingResponse
from ..services import attendance_service
from ..face_engine import face_engine
from ..models import TrainingLog

router = APIRouter(prefix="/train", tags=["Model Training"])

@router.post("", response_model=TrainingResponse)
def train_model(db: Session = Depends(get_db)):
    """
    Trains the OpenCV LBPH face recognition model on all registered student samples.
    Saves the trained YAML model and label map.
    """
    try:
        result = attendance_service.train_face_model(db)
        return TrainingResponse(
            success=True,
            message=result["message"],
            total_students=result["total_students"],
            total_samples=result["total_samples"],
            duration_seconds=result["duration_seconds"]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")

@router.get("/status")
def get_training_status(db: Session = Depends(get_db)):
    """Checks whether model is trained and returns status/metadata."""
    is_trained = face_engine.is_model_loaded()
    last_log = db.query(TrainingLog).order_by(desc(TrainingLog.trained_at)).first()
    
    return {
        "model_trained": is_trained,
        "total_registered_classes": len(face_engine.label_to_id),
        "last_trained_at": last_log.trained_at.isoformat() if last_log else None,
        "last_training_status": last_log.status if last_log else "never_trained",
        "last_training_message": last_log.message if last_log else "No training runs yet."
    }

@router.get("/evaluate")
def evaluate_model():
    """Runs evaluation metrics on registered face samples."""
    try:
        metrics = face_engine.evaluate_model()
        return metrics
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")
