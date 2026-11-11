# Aapka PG — PG / Hostel Management System

Full-stack Paying Guest (PG) and Hostel operations platform built with **FastAPI + SQLAlchemy + Alembic** (`backend/`) and **React + TypeScript + Vite + Tailwind CSS** (`frontend/`).

## Roles & Modules

- **Owner (`owner`)**: Multi-PG portfolio financial dashboard, revenue vs expense/pending analytics, monthly financial reports (CSV & PDF), manual rent reminders & offline payments, manager account administration, PG property settings (defaults, meal timings, amenities), live vacancy management, and public vacancy share links.
- **Manager (`manager`)**: Room and bed lifecycle, tenant onboarding and KYC document uploads, notice-period & checkout settlement with security deposit deductions and bed maintenance guards, monthly rent generation, offline payment recording & PDF receipts, complaint workflow (`submitted -> viewed_by_manager -> in_progress -> resolved`), and weekly food menu + meal image publishing.
- **Tenant (`tenant`)**: Personal stay & allocation profile, rent ledger & PDF receipt downloads, optional online Razorpay checkout (when credentials are configured), maintenance complaints with image upload & post-resolution ratings, weekly food menu with cut-off-enforced meal skip requests and meal ratings, and in-app notifications.
- **Public Vacancy (`unauthenticated`)**: Share-link and public directory endpoints exposing only non-sensitive property info and explicitly published vacant/notice-period beds—never tenant PII.

> **Scope Note**: Electricity meter readings, unit calculations, meter photo uploads, and electricity billing UI/API features are intentionally excluded by design.

## Tech Stack

- **Backend**: Python, FastAPI, SQLAlchemy 2, Alembic, Pydantic, JWT (`PyJWT`), `bcrypt`, SQLite (dev) / PostgreSQL-ready (`DATABASE_URL`).
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, React Router, Axios, Lucide React, Recharts.

## Local Setup

### 1. Backend

```powershell
cd backend
.\.venv\Scripts\activate
copy .env.example .env
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

- Health checks: `GET /health` and `GET /api/health`
- API docs: `http://127.0.0.1:8000/docs`

### 2. Frontend

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

- App URL: `http://localhost:5173` (Vite proxies `/api/*` to `http://127.0.0.1:8000`)
- Production bundle check: `npm run build`

## Development Credentials (`python -m app.seed`)

| Role | Mobile | Password |
| :--- | :--- | :--- |
| Owner (Malik) | `9800000001` | `Owner@123` |
| Manager | `9800000002` | `Manager@123` |
| Tenant | `9800000003` | `Tenant@123` |

- **Development OTP Mode**: Controlled by `DEV_OTP_MODE` and `DEV_OTP_CODE` in `backend/.env`. This is strictly a local development convenience; real SMS provider delivery is not integrated.
- **Online Payments**: Disabled by default (`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` blank). Offline payment recording (Cash, UPI, Bank Transfer) and instant PDF receipt generation work out of the box.

## PostgreSQL Migration Path

Update `DATABASE_URL` in `backend/.env` to a PostgreSQL connection string (and install `psycopg[binary]` listed in `backend/requirements.txt`), then run:

```powershell
alembic upgrade head
```

## Verification

- Backend automated tests (`pytest`):
  ```powershell
  cd backend
  .\.venv\Scripts\pytest.exe -v
  ```
- Frontend TypeScript check & production build:
  ```powershell
  cd frontend
  npm run build
  ```

