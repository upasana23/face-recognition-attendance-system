import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .config import settings
from .database import init_db
from .api import students, training, attendance, reports

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables
    init_db()
    yield

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Face Recognition-Based Smart Attendance System powered by FastAPI, OpenCV, and LBPH.",
    lifespan=lifespan
)

# Configure Cross-Origin Resource Sharing (CORS) for external frontend (e.g. Vercel)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins including Vercel deployments
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(students.router, prefix=settings.API_V1_STR)
app.include_router(training.router, prefix=settings.API_V1_STR)
app.include_router(attendance.router, prefix=settings.API_V1_STR)
app.include_router(reports.router, prefix=settings.API_V1_STR)

@app.get("/api/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": "1.0.0"
    }

# Mount static frontend files for convenient single-command local development
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/", include_in_schema=False)
    def serve_frontend_root():
        index_file = FRONTEND_DIR / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return {"message": "Smart Attendance API is running. Frontend directory found."}

    # Serve static assets (css, js, assets) seamlessly
    @app.get("/{path:path}", include_in_schema=False)
    def serve_frontend_assets(path: str):
        # Don't intercept API routes or docs
        if path.startswith("api") or path.startswith("docs") or path.startswith("openapi.json"):
            return None
        file_path = FRONTEND_DIR / path
        if file_path.is_file():
            return FileResponse(str(file_path))
        index_file = FRONTEND_DIR / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return {"message": "Resource not found"}
