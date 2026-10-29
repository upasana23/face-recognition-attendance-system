import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATASET_DIR = DATA_DIR / "dataset"
MODELS_DIR = DATA_DIR / "models"
EXPORTS_DIR = DATA_DIR / "exports"

# Ensure data directories exist
DATASET_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

class Settings:
    APP_NAME: str = os.getenv("APP_NAME", "SmartFace Attendance System")
    API_V1_STR: str = "/api"
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'attendance.db'}")
    MODEL_PATH: str = os.getenv("MODEL_PATH", str(MODELS_DIR / "lbph_model.yml"))
    LABEL_MAP_PATH: str = os.getenv("LABEL_MAP_PATH", str(MODELS_DIR / "label_map.json"))
    DATASET_DIR: str = str(DATASET_DIR)
    EXPORTS_DIR: str = str(EXPORTS_DIR)
    
    # LBPH confidence is a distance: lower = better match.
    # Typically < 75 is a valid match, > 75 is considered unknown.
    CONFIDENCE_THRESHOLD: float = float(os.getenv("CONFIDENCE_THRESHOLD", "75.0"))
    FACE_IMAGE_SIZE: tuple[int, int] = (200, 200)
    SAMPLES_PER_STUDENT_DEFAULT: int = int(os.getenv("SAMPLES_PER_STUDENT_DEFAULT", "15"))

    # CORS origins
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:5500",
        "https://*.vercel.app",
        "*"
    ]

settings = Settings()
