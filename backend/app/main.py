from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as api_health_router
from app.core.config import get_settings
from app.core.database import init_db
from app.core.exceptions import register_exception_handlers
from app.routers import auth, complaints_food, files, finance, manager, owner, public, rooms_tenants, tenant

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    if not os.environ.get("PYTEST_CURRENT_TEST"):
        init_db()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description=(
        "Production-oriented PG / Hostel Management System API "
        "(Role-based access for Owner/Malik, Manager, and Tenant)."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    """Basic service health endpoint."""
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "environment": settings.ENVIRONMENT}


app.include_router(api_health_router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(rooms_tenants.rooms_router, prefix="/api")
app.include_router(rooms_tenants.beds_router, prefix="/api")
app.include_router(rooms_tenants.tenants_router, prefix="/api")
app.include_router(finance.rent_router, prefix="/api")
app.include_router(finance.payments_router, prefix="/api")
app.include_router(finance.receipts_router, prefix="/api")
app.include_router(finance.deposits_router, prefix="/api")
app.include_router(complaints_food.complaints_router, prefix="/api")
app.include_router(complaints_food.food_router, prefix="/api")
app.include_router(complaints_food.notifications_router, prefix="/api")
app.include_router(owner.router, prefix="/api")
app.include_router(owner.vacancy_router, prefix="/api")
app.include_router(public.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(tenant.router, prefix=settings.API_V1_PREFIX)
app.include_router(manager.router, prefix=settings.API_V1_PREFIX)
app.include_router(owner.router, prefix=settings.API_V1_PREFIX)
app.include_router(public.router, prefix=settings.API_V1_PREFIX)
app.include_router(files.router, prefix=settings.API_V1_PREFIX)
