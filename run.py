import uvicorn
import os
import sys

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

if __name__ == "__main__":
    # Ensure root directory is in sys.path
    root_dir = os.path.dirname(os.path.abspath(__file__))
    if root_dir not in sys.path:
        sys.path.insert(0, root_dir)

    print("=" * 60)
    print("  * Starting Face Recognition Smart Attendance System")
    print("  * Access UI & API at: http://localhost:8000")
    print("  * Swagger API Docs:   http://localhost:8000/docs")
    print("=" * 60)

    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
