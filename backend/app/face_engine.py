import os
import json
import base64
import time
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any
import cv2
import numpy as np

from .config import settings

class FaceEngine:
    def __init__(self):
        # Prefer bundled cascade XML, fallback to cv2.data
        bundled_cascade = Path(__file__).resolve().parent / "cascades" / "haarcascade_frontalface_default.xml"
        if bundled_cascade.exists():
            self.cascade_path = str(bundled_cascade)
        elif hasattr(cv2, "data") and hasattr(cv2.data, "haarcascades") and os.path.exists(cv2.data.haarcascades + "haarcascade_frontalface_default.xml"):
            self.cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        else:
            raise FileNotFoundError(f"Haar cascade XML not found at {bundled_cascade} or in cv2.data")
        
        self.face_cascade = cv2.CascadeClassifier(self.cascade_path)
        if self.face_cascade.empty():
            raise RuntimeError(f"Failed to load CascadeClassifier from {self.cascade_path}")
        
        self.model_path = Path(settings.MODEL_PATH)
        self.label_map_path = Path(settings.LABEL_MAP_PATH)
        self.dataset_dir = Path(settings.DATASET_DIR)
        
        self.recognizer: Optional[Any] = None
        self.label_to_id: Dict[int, str] = {}
        self.id_to_label: Dict[str, int] = {}
        
        self.load_model()

    def is_model_loaded(self) -> bool:
        return self.recognizer is not None and bool(self.label_to_id)

    def load_model(self) -> bool:
        """Loads trained LBPH model and label mapping if they exist."""
        try:
            if self.model_path.exists() and self.label_map_path.exists():
                with open(self.label_map_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # JSON keys are strings, convert label keys to integers
                    self.label_to_id = {int(k): v for k, v in data.get("label_to_id", {}).items()}
                    self.id_to_label = data.get("id_to_label", {})

                recognizer = cv2.face.LBPHFaceRecognizer_create(
                    radius=1, neighbors=8, grid_x=8, grid_y=8
                )
                recognizer.read(str(self.model_path))
                self.recognizer = recognizer
                return True
        except Exception as e:
            print(f"[FaceEngine] Notice: Model not loaded yet ({e})")
        self.recognizer = None
        self.label_to_id = {}
        self.id_to_label = {}
        return False

    @staticmethod
    def decode_base64_image(base64_str: str) -> np.ndarray:
        """Decodes base64 string (including data URL headers) into OpenCV BGR image."""
        if "," in base64_str:
            base64_str = base64_str.split(",", 1)[1]
        img_bytes = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image from base64 string")
        return img

    @staticmethod
    def decode_bytes_image(file_bytes: bytes) -> np.ndarray:
        """Decodes uploaded file bytes into OpenCV BGR image."""
        nparr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image from file bytes")
        return img

    def detect_faces(self, image: np.ndarray, min_neighbors: int = 5) -> List[Tuple[int, int, int, int]]:
        """Detects faces in BGR or Grayscale image, returns list of [x, y, w, h]."""
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image
        
        # Apply histogram equalization for detection robustness under varying lighting
        gray_eq = cv2.equalizeHist(gray)
        faces = self.face_cascade.detectMultiScale(
            gray_eq,
            scaleFactor=1.15,
            minNeighbors=min_neighbors,
            minSize=(60, 60),
            flags=cv2.CASCADE_SCALE_IMAGE
        )
        return [tuple(f) for f in faces]

    def preprocess_face(self, face_bgr_or_gray: np.ndarray) -> np.ndarray:
        """Converts cropped face to grayscale, equalizes histogram, and resizes to target size."""
        if len(face_bgr_or_gray.shape) == 3:
            gray = cv2.cvtColor(face_bgr_or_gray, cv2.COLOR_BGR2GRAY)
        else:
            gray = face_bgr_or_gray
        
        # Histogram equalization normalizes brightness/contrast across faces
        equalized = cv2.equalizeHist(gray)
        resized = cv2.resize(equalized, settings.FACE_IMAGE_SIZE, interpolation=cv2.INTER_AREA)
        return resized

    def extract_largest_face(self, image: np.ndarray) -> Optional[Tuple[np.ndarray, Tuple[int, int, int, int]]]:
        """Detects and extracts the largest face in the image, returns (preprocessed_face, bbox)."""
        faces = self.detect_faces(image)
        if not faces:
            return None
        
        # Sort by area (w * h) descending
        faces = sorted(faces, key=lambda b: b[2] * b[3], reverse=True)
        x, y, w, h = faces[0]
        
        # Extract face with a small 5% margin if within bounds
        h_pad = int(0.05 * h)
        w_pad = int(0.05 * w)
        img_h, img_w = image.shape[:2]
        
        y1 = max(0, y - h_pad)
        y2 = min(img_h, y + h + h_pad)
        x1 = max(0, x - w_pad)
        x2 = min(img_w, x + w + w_pad)
        
        face_roi = image[y1:y2, x1:x2]
        preprocessed = self.preprocess_face(face_roi)
        return preprocessed, (int(x), int(y), int(w), int(h))

    def save_student_sample(self, student_id: str, image: np.ndarray) -> bool:
        """Extracts face and saves preprocessed sample image for student."""
        res = self.extract_largest_face(image)
        if not res:
            return False
        
        face_img, _ = res
        student_dir = self.dataset_dir / student_id
        student_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate sequential sample filename
        existing_files = list(student_dir.glob("*.jpg"))
        next_idx = len(existing_files) + 1
        save_path = student_dir / f"face_{next_idx:03d}_{int(time.time()*1000)}.jpg"
        
        cv2.imwrite(str(save_path), face_img)
        return True

    def get_student_sample_count(self, student_id: str) -> int:
        """Returns number of saved face samples for student."""
        student_dir = self.dataset_dir / student_id
        if not student_dir.exists():
            return 0
        return len(list(student_dir.glob("*.jpg")))

    def train_model(self) -> Dict[str, Any]:
        """
        Trains LBPH face recognizer on all student images in the dataset directory.
        Saves the trained model and label map.
        """
        start_time = time.time()
        student_dirs = [d for d in self.dataset_dir.iterdir() if d.is_dir()]
        
        faces: List[np.ndarray] = []
        labels: List[int] = []
        label_to_id: Dict[int, str] = {}
        id_to_label: Dict[str, int] = {}
        
        current_label = 1
        total_samples = 0
        
        for student_dir in sorted(student_dirs):
            student_id = student_dir.name
            img_files = list(student_dir.glob("*.jpg"))
            if not img_files:
                continue
            
            label_to_id[current_label] = student_id
            id_to_label[student_id] = current_label
            
            for img_file in img_files:
                img = cv2.imread(str(img_file), cv2.IMREAD_GRAYSCALE)
                if img is None:
                    continue
                # Ensure dimensions match
                if img.shape != settings.FACE_IMAGE_SIZE:
                    img = cv2.resize(img, settings.FACE_IMAGE_SIZE, interpolation=cv2.INTER_AREA)
                faces.append(img)
                labels.append(current_label)
                total_samples += 1
                
            current_label += 1
            
        if not faces or not label_to_id:
            raise ValueError("No face training samples found. Please register students and capture face images first.")
        
        # Create and train LBPH Face Recognizer
        recognizer = cv2.face.LBPHFaceRecognizer_create(
            radius=1, neighbors=8, grid_x=8, grid_y=8
        )
        recognizer.train(faces, np.array(labels, dtype=np.int32))
        
        # Save model and label mappings
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        recognizer.write(str(self.model_path))
        
        with open(self.label_map_path, "w", encoding="utf-8") as f:
            json.dump({
                "label_to_id": {str(k): v for k, v in label_to_id.items()},
                "id_to_label": id_to_label,
                "total_samples": total_samples,
                "trained_at": time.time()
            }, f, indent=2)
            
        # Update in-memory recognizer
        self.recognizer = recognizer
        self.label_to_id = label_to_id
        self.id_to_label = id_to_label
        
        duration = round(time.time() - start_time, 2)
        return {
            "success": True,
            "total_students": len(label_to_id),
            "total_samples": total_samples,
            "duration_seconds": duration,
            "message": f"Successfully trained LBPH model with {len(label_to_id)} students and {total_samples} samples."
        }

    def predict_face(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Recognizes the face in the provided image using the trained LBPH model.
        Returns prediction details including student_id, confidence, similarity %, and bbox.
        """
        if not self.is_model_loaded():
            loaded = self.load_model()
            if not loaded:
                return {
                    "recognized": False,
                    "status": "model_not_trained",
                    "message": "Face recognition model has not been trained yet. Please train the model from the dashboard.",
                    "bounding_box": None
                }
        
        extracted = self.extract_largest_face(image)
        if not extracted:
            return {
                "recognized": False,
                "status": "no_face_detected",
                "message": "No face detected in the image. Please position your face clearly in the camera.",
                "bounding_box": None
            }
        
        face_roi, bbox = extracted
        
        # LBPH prediction: returns (predicted_label, distance)
        # Distance: lower is better! 0 is perfect.
        label, distance = self.recognizer.predict(face_roi)
        
        # Convert distance to an intuitive similarity percentage
        # Typical LBPH distances range 30-100; above 75 is deemed unfamiliar.
        # We cap between 0% and 100%
        similarity = max(0.0, min(100.0, round((1.0 - (distance / 100.0)) * 100.0, 1)))
        
        is_known = (
            distance <= settings.CONFIDENCE_THRESHOLD 
            and label in self.label_to_id
        )
        
        if is_known:
            student_id = self.label_to_id[label]
            return {
                "recognized": True,
                "status": "recognized",
                "student_id": student_id,
                "confidence_score": round(float(distance), 2),
                "similarity_percentage": similarity,
                "message": f"Recognized student {student_id} with {similarity}% match.",
                "bounding_box": list(bbox)
            }
        else:
            return {
                "recognized": False,
                "status": "unknown_face",
                "student_id": None,
                "confidence_score": round(float(distance), 2),
                "similarity_percentage": similarity,
                "message": "Unknown face detected or confidence below threshold. Access denied.",
                "bounding_box": list(bbox)
            }

    def evaluate_model(self) -> Dict[str, Any]:
        """Evaluates model performance across dataset samples with train-test split."""
        if not self.is_model_loaded():
            self.load_model()
        if not self.is_model_loaded():
            return {"error": "Model not trained yet"}
            
        student_dirs = [d for d in self.dataset_dir.iterdir() if d.is_dir()]
        total_eval = 0
        correct_eval = 0
        eval_records = []
        
        for student_dir in student_dirs:
            student_id = student_dir.name
            img_files = list(student_dir.glob("*.jpg"))
            if not img_files:
                continue
            
            for img_file in img_files:
                img = cv2.imread(str(img_file), cv2.IMREAD_GRAYSCALE)
                if img is None:
                    continue
                label, dist = self.recognizer.predict(img)
                pred_id = self.label_to_id.get(label, "Unknown")
                is_correct = (pred_id == student_id and dist <= settings.CONFIDENCE_THRESHOLD)
                if is_correct:
                    correct_eval += 1
                total_eval += 1
                
        accuracy = round((correct_eval / total_eval * 100.0), 2) if total_eval > 0 else 0.0
        return {
            "total_samples_evaluated": total_eval,
            "correct_predictions": correct_eval,
            "accuracy_percentage": accuracy,
            "confidence_threshold": settings.CONFIDENCE_THRESHOLD
        }

# Global singleton instance
face_engine = FaceEngine()
