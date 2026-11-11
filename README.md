# 🏠 PGManagement System

A full-stack **PG  Management System** designed to simplify property management, tenant administration, rent tracking, complaints, food management, and vacancy monitoring through a centralized web application.

The platform provides separate dashboards for Owners, Managers, and Tenants, with role-based access control and a user-friendly interface.

## ✨ Key Features

### 🔐 Authentication & User Management
- Secure user authentication.
- Mobile number and OTP-based login.
- Password-based login.
- Tenant registration.
- Role-Based Access Control (RBAC).
- Separate access for Owners, Managers, and Tenants.

### 🏢 Room & Tenant Management
- Manage rooms and beds.
- Register and manage tenants.
- Assign tenants to available beds.
- Upload and manage tenant documents.
- Tenant checkout and history management.
- Security deposit tracking and settlement.

### 💰 Rent & Financial Management
- Monthly rent management.
- Record full and partial payments.
- Track pending and overdue rent.
- Payment history and receipts.
- Security deposit management.
- Financial reports and exports.

### 📢 Complaint Management
- Tenants can submit complaints.
- Upload complaint images.
- Managers can review and update complaints.
- Track complaint status and history.
- Monitor complaint resolution.

### 🍽️ Food & Meal Management
- Weekly food menu management.
- Breakfast, lunch, and dinner schedules.
- Meal skip requests.
- Food ratings and feedback.

### 📊 Owner Dashboard & Vacancy Management
- Monthly rent collection overview.
- Pending and overdue rent statistics.
- Tenant and occupancy overview.
- Recent activities.
- Room and bed availability.
- Vacancy tracking.
- Maintenance status management.
- Financial reports and visual analytics.

### 👥 Role-Based Dashboards

| Role | Access |
|---|---|
| Owner | Dashboard, financial reports, properties, tenants, vacancies and overall management |
| Manager | Assigned property management, tenants, complaints, food menus and vacancies |
| Tenant | Personal profile, rent, payments, complaints, food menu and meal requests |

## 🛠️ Technology Stack

### Frontend
- React.js
- TypeScript
- Vite
- Tailwind CSS
- Shadcn UI
- React Router
- Axios
- Lucide React
- Recharts

### Backend
- Python
- FastAPI
- SQLAlchemy
- Pydantic
- JWT Authentication

### Database
- SQLite

### Development Tools
- Git
- GitHub
- VS Code
- Antigravity IDE
- Postman / Swagger UI

## 🏗️ Project Architecture

```text
PG-Management-System/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   │
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── ...
│   │
│   ├── package.json
│   └── ...
│
├── .gitignore
└── README.md
```

*Note: The directory structure above is illustrative. Actual folders may differ as the project evolves.*

## ⚙️ Installation & Setup

### Prerequisites

Install the following:

- Python 3.10 or later (compatible with project dependencies).
- Node.js and npm.
- Git.

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/PG-Management-System.git
cd PG-Management-System
```

### 2. Backend Setup

Open a terminal:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv .venv
```

Activate it on Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Configure environment variables using the provided `.env.example` file. Add your own development configuration and secrets locally.

Start the backend:

```bash
uvicorn app.main:app --reload
```

Backend URL:

```text
http://127.0.0.1:8000
```

Swagger API documentation:

```text
http://127.0.0.1:8000/docs
```

### 3. Frontend Setup

Open another terminal:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## 🔒 Security

- Password hashing.
- JWT-based authentication.
- Backend-enforced role-based authorization.
- Input validation.
- Protected API endpoints.
- Property-level access restrictions.
- Secure handling of environment variables.

## 📸 Screenshots

Add screenshots of the application here after finalizing the UI.

Suggested screenshots:
- Login and registration page.
- Owner dashboard.
- Manager dashboard.
- Tenant dashboard.
- Room and tenant management.
- Rent and payment management.
- Complaint management.
- Food menu.
- Vacancy management.

Example:

```markdown
![Owner Dashboard](screenshots/owner-dashboard.png)
```

## 🚀 Future Enhancements

- Enhanced AI-powered tenant and property insights.
- Improved analytics and reporting.
- SMS and notification service integration.
- Production payment gateway integration.
- Advanced vacancy and occupancy analytics.
- Cloud deployment and scalability improvements.

## 👨‍💻 Developer

**Bharath Kumar**

- GitHub: [bharath-6363-ab](https://github.com/bharath-6363-ab)
- LinkedIn: [Bharath](https://www.linkedin.com/in/bharath-07-m/)

## 📄 License

This project is developed for academic and educational purposes.

---

⭐ If you find this project interesting, consider giving the repository a star!
