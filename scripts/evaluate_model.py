import sys
from pathlib import Path

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Add workspace root to Python path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from backend.app.face_engine import face_engine
from backend.app.config import settings

def run_evaluation():
    print("=" * 60)
    print("  [LBPH Face Recognition Model Evaluation]")
    print(f"  Model path: {settings.MODEL_PATH}")
    print(f"  Confidence Threshold: {settings.CONFIDENCE_THRESHOLD}")
    print("=" * 60)

    if not face_engine.is_model_loaded():
        print("[Notice] Model is not loaded. Attempting to train or load...")
        try:
            train_res = face_engine.train_model()
            print(f"[Success] Trained model: {train_res}")
        except Exception as e:
            print(f"[Error] During training/loading: {e}")
            return

    results = face_engine.evaluate_model()
    print("\n--- Evaluation Summary ---")
    print(f"Total Samples Evaluated: {results.get('total_samples_evaluated')}")
    print(f"Correct Predictions:     {results.get('correct_predictions')}")
    print(f"Accuracy Rate:           {results.get('accuracy_percentage')}%")
    print(f"Threshold:               {results.get('confidence_threshold')}")
    print("=" * 60)

if __name__ == "__main__":
    run_evaluation()
