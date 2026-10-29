# 👁️ SmartFace: Face Recognition-Based Smart Attendance System

An automated, biometric Smart Attendance System built with **Python, FastAPI, OpenCV, Haar Cascade, and Local Binary Patterns Histograms (LBPH)** with a modern, glassmorphic web dashboard.

---

## 🌟 Key Features

1. **Student Registration:**
   - Enrol student details (Student ID, Full Name, Department, Email).
   - Automated multi-shot face capture via webcam (15 samples captured at varied angles) or batch image file upload.
   - Built-in preprocessing: automatic face detection, grayscale conversion, histogram equalization (lighting normalization), and resize to standard 200×200 pixels.

2. **Model Training & Evaluation:**
   - Trains OpenCV's **LBPH Face Recognizer** (`cv2.face.LBPHFaceRecognizer_create`) on captured dataset vectors.
   - Saves model weights to `lbph_model.yml` and label mappings to `label_map.json`.
   - Standalone evaluation metrics: accuracy percentages, test predictions, and Chi-Square distance analysis.

3. **Live Attendance & Automated Logging:**
   - Real-time in-browser WebRTC webcam capture with HUD face bounding box canvas overlay.
   - Configurable session names (`Daily`, `Morning`, `Afternoon`, `Lab`).
   - Image upload fallback for non-webcam devices.
   - Audio feedback chimes via pure Web Audio API for success, duplicate, or unknown rejection.

4. **Strict Duplicate Prevention:**
   - Enforces unique constraint: **one attendance check-in per student per session/day**.
   - Repeated attempts return `already_marked` with the original check-in timestamp.
   - Unknown faces (distance > threshold) are rejected with an explicit alert.

5. **Analytics & Reporting Dashboard:**
   - Live KPI counters: Total enrolled students, Today's check-ins, Today's attendance rate %, and LBPH engine status.
   - Student-wise cumulative attendance rate percentages with progress bars.
   - Daily attendance log with date picker filter.
   - 1-click **Download CSV Report** powered by Pandas.

6. **Privacy & Ethical Biometric Standards:**
   - Explicit user participation and real-time capture feedback.
   - Local storage of face representations with threshold verification.

---

## 📁 Project Directory Structure

```text
imgprocessing/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app, CORS, static mounting, routers
│   │   ├── config.py            # Settings, thresholds, data paths
│   │   ├── database.py          # SQLAlchemy SQLite connection & session
│   │   ├── models.py            # Database tables (Student, Attendance, TrainingLog)
│   │   ├── schemas.py           # Pydantic validation schemas
│   │   ├── face_engine.py       # OpenCV Haar Cascade detection & LBPH training/inference
│   │   ├── services.py          # Business logic: registration, duplicate check, reports
│   │   ├── cascades/
│   │   │   └── haarcascade_frontalface_default.xml # Bundled offline Haar Cascade model
│   │   └── api/
│   │       ├── __init__.py
│   │       ├── students.py      # Student registration & sample endpoints
│   │       ├── training.py      # LBPH model training & evaluation
│   │       ├── attendance.py    # Live attendance marking & stats
│   │       └── reports.py       # Attendance analytics & CSV export
│   ├── data/
│   │   ├── dataset/             # Organized student face images by student_id
│   │   ├── models/              # lbph_model.yml & label_map.json
│   │   ├── attendance.db        # SQLite database
│   │   └── exports/             # Exported CSV reports
│   ├── Dockerfile               # Container definition for Python backend
│   └── requirements.txt         # Python dependencies
├── frontend/
│   ├── index.html               # Responsive Single Page Application UI
│   ├── css/
│   │   └── style.css            # Modern glassmorphic theme & layout
│   ├── js/
│   │   ├── app.js               # State management, API calls, notifications
│   │   ├── webcam.js            # WebRTC camera, canvas bounding box, audio chimes
│   │   └── charts.js            # SVG circular gauges and progress bars
│   ├── vercel.json              # Vercel deployment configuration
│   └── package.json             # Frontend metadata and scripts
├── scripts/
│   ├── seed_demo.py             # Demo data generator (5 demo students & records)
│   ├── evaluate_model.py        # Model accuracy and evaluation benchmark CLI
│   └── test_system.py           # Comprehensive automated test suite
├── .env.example                 # Environment variable template
├── render.yaml                  # 1-click Render blueprint with persistent disk
├── run.py                       # Single-command local launcher
└── README.md                    # Documentation
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Python 3.10+ (Python 3.11, 3.12, 3.13, 3.14 supported)
- Webcam (optional; photo file upload is available as a fallback)

### 1. Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### 2. (Optional) Seed Demo Data
To test the dashboard immediately with sample students and historical logs:
```bash
python scripts/seed_demo.py
```

### 3. Run the System
```bash
python run.py
```

Open your browser at:
- **Web Dashboard:** [http://localhost:8000](http://localhost:8000)
- **Interactive Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🌐 Deployment Architecture

As specified in the deployment requirements:
- The **Frontend** is hosted as a static Single Page Application on **Vercel**.
- The **Python Backend** (with OpenCV, SQLite, and persistent dataset storage) is hosted on a Python-compatible cloud platform such as **Render**, **Railway**, or a VPS / Docker container.

### A. Deploy Frontend on Vercel

1. **Push your repository to GitHub / GitLab**.
2. Go to [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Import your repository.
4. Set the **Root Directory** to `frontend`.
5. Leave Build Command and Output Directory as default (static files are served directly using `frontend/vercel.json`).
6. Click **Deploy**.
7. Once deployed, open your Vercel URL, go to the **System Settings** tab in the dashboard, enter your hosted backend API URL (e.g. `https://your-api.onrender.com`), and click **Save & Test Connection**.

---

### B. Deploy Backend on Render / Railway / Docker

#### Option 1: Render (Blueprint or Web Service)
1. In Render, select **"New +"** -> **"Web Service"** (or use the included `render.yaml` blueprint).
2. Connect your GitHub repository.
3. Configure:
   - **Environment:** `Docker`
   - **Dockerfile Path:** `./backend/Dockerfile`
   - **Docker Context:** `.`
   - **Plan:** Free or Starter
4. **Persistent Disk (Important for dataset & models):**
   - Mount Path: `/app/backend/data`
   - Size: 1 GB - 5 GB
5. Click **Deploy**.
6. Copy your public Render URL (e.g., `https://smart-face-api.onrender.com`) and paste it into the frontend's **System Settings** tab.

#### Option 2: Railway / VPS with Docker
```bash
docker build -t smartface-backend -f backend/Dockerfile .
docker run -d -p 8000:8000 -v $(pwd)/backend/data:/app/backend/data smartface-backend
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status check |
| `POST` | `/api/students` | Register a new student profile |
| `GET` | `/api/students` | Retrieve all registered students |
| `GET` | `/api/students/{id}` | Retrieve specific student details |
| `POST` | `/api/students/{id}/samples` | Upload base64 webcam face capture burst |
| `POST` | `/api/students/{id}/upload-files`| Upload image files for student |
| `DELETE` | `/api/students/{id}` | Delete student and associated face dataset |
| `POST` | `/api/train` | Train OpenCV LBPH model on all dataset images |
| `GET` | `/api/train/status` | Model status, classes count, and last training log |
| `GET` | `/api/train/evaluate` | Compute model accuracy on dataset |
| `POST` | `/api/attendance/mark` | Mark attendance via base64 webcam frame (with duplicate prevention) |
| `POST` | `/api/attendance/upload` | Mark attendance via uploaded image file |
| `GET` | `/api/attendance` | Query attendance logs (filterable by date & student_id) |
| `GET` | `/api/attendance/stats` | High-level KPI counters for dashboard |
| `GET` | `/api/reports/analytics` | Cumulative attendance percentages per student |
| `GET` | `/api/reports/export/csv` | Download attendance records as CSV file |

---

## 🧪 Testing & Verification

Run the included automated test suite to verify all components:
```bash
python scripts/test_system.py
```

Run model evaluation:
```bash
python scripts/evaluate_model.py
```

---

## ⚖️ Biometric Privacy Notice
This system processes facial images solely for educational attendance verification with user consent. Facial matrices are equalized, resized, and translated into mathematical LBPH histogram vectors without external data sharing.
