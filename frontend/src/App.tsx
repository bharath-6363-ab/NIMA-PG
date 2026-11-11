import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/ProtectedRoute";
import { LoadingState } from "@/components/shared/StateHelpers";
import { ToastProvider } from "@/components/shared/ToastProvider";
import { AuthProvider, roleHomePath, useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/layouts/AppLayout";

const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage }))
);
const TenantRegisterPage = lazy(() =>
  import("@/pages/TenantRegisterPage").then((m) => ({
    default: m.TenantRegisterPage,
  }))
);
const SystemHealthPage = lazy(() =>
  import("@/pages/SystemHealthPage").then((m) => ({ default: m.SystemHealthPage }))
);
const UserAccessPage = lazy(() =>
  import("@/pages/auth/UserAccessPage").then((m) => ({ default: m.UserAccessPage }))
);
const ManagerDashboardPage = lazy(() =>
  import("@/pages/dashboards/ManagerDashboardPage").then((m) => ({
    default: m.ManagerDashboardPage,
  }))
);
const DepositManagementPage = lazy(() =>
  import("@/pages/finance/DepositManagementPage").then((m) => ({
    default: m.DepositManagementPage,
  }))
);
const RentManagementPage = lazy(() =>
  import("@/pages/finance/RentManagementPage").then((m) => ({
    default: m.RentManagementPage,
  }))
);
const ComplaintManagementPage = lazy(() =>
  import("@/pages/operations/ComplaintManagementPage").then((m) => ({
    default: m.ComplaintManagementPage,
  }))
);
const FoodManagementPage = lazy(() =>
  import("@/pages/operations/FoodManagementPage").then((m) => ({
    default: m.FoodManagementPage,
  }))
);
const VacancyManagementPage = lazy(() =>
  import("@/pages/operations/VacancyManagementPage").then((m) => ({
    default: m.VacancyManagementPage,
  }))
);
const FinancialReportsPage = lazy(() =>
  import("@/pages/owner/FinancialReportsPage").then((m) => ({
    default: m.FinancialReportsPage,
  }))
);
const OwnerDashboardPage = lazy(() =>
  import("@/pages/owner/OwnerDashboardPage").then((m) => ({
    default: m.OwnerDashboardPage,
  }))
);
const PGSettingsPage = lazy(() =>
  import("@/pages/owner/PGSettingsPage").then((m) => ({
    default: m.PGSettingsPage,
  }))
);
const PublicVacancyPage = lazy(() =>
  import("@/pages/public/PublicVacancyPage").then((m) => ({
    default: m.PublicVacancyPage,
  }))
);
const BedManagementPage = lazy(() =>
  import("@/pages/rooms/BedManagementPage").then((m) => ({
    default: m.BedManagementPage,
  }))
);
const RoomDetailsPage = lazy(() =>
  import("@/pages/rooms/RoomDetailsPage").then((m) => ({
    default: m.RoomDetailsPage,
  }))
);
const RoomManagementPage = lazy(() =>
  import("@/pages/rooms/RoomManagementPage").then((m) => ({
    default: m.RoomManagementPage,
  }))
);
const MyProfilePage = lazy(() =>
  import("@/pages/tenant/MyProfilePage").then((m) => ({
    default: m.MyProfilePage,
  }))
);
const OnlineRentPage = lazy(() =>
  import("@/pages/tenant/OnlineRentPage").then((m) => ({
    default: m.OnlineRentPage,
  }))
);
const TenantComplaintsPage = lazy(() =>
  import("@/pages/tenant/TenantComplaintsPage").then((m) => ({
    default: m.TenantComplaintsPage,
  }))
);
const TenantFoodMenuPage = lazy(() =>
  import("@/pages/tenant/TenantFoodMenuPage").then((m) => ({
    default: m.TenantFoodMenuPage,
  }))
);
const TenantProfilePage = lazy(() =>
  import("@/pages/tenants/TenantProfilePage").then((m) => ({
    default: m.TenantProfilePage,
  }))
);
const TenantRegistrationPage = lazy(() =>
  import("@/pages/tenants/TenantRegistrationPage").then((m) => ({
    default: m.TenantRegistrationPage,
  }))
);
const TenantsListPage = lazy(() =>
  import("@/pages/tenants/TenantsListPage").then((m) => ({
    default: m.TenantsListPage,
  }))
);

function HomeRedirect() {
  const { user, initializing } = useAuth();
  if (initializing) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHomePath(user.role)} replace />;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingState label="Loading page..." />}>
            <Routes>
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<TenantRegisterPage />} />
              </Route>

              {/* Unauthenticated Public Vacancy Listing Routes */}
              <Route path="/vacancy/:token" element={<PublicVacancyPage />} />
              <Route path="/public-vacancies" element={<PublicVacancyPage />} />

              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<HomeRedirect />} />
                  <Route path="/system-health" element={<SystemHealthPage />} />

                  {/* Owner & Manager Room / Bed / Tenant Management */}
                  <Route element={<ProtectedRoute allowedRoles={["owner", "manager"]} />}>
                    <Route path="/rooms" element={<RoomManagementPage />} />
                    <Route path="/rooms/:roomId" element={<RoomDetailsPage />} />
                    <Route path="/beds" element={<BedManagementPage />} />
                    <Route path="/tenants" element={<TenantsListPage />} />
                    <Route path="/tenants/new" element={<TenantRegistrationPage />} />
                    <Route path="/tenants/:tenantId" element={<TenantProfilePage />} />
                    <Route path="/rent-management" element={<RentManagementPage />} />
                    <Route path="/deposits" element={<DepositManagementPage />} />
                    <Route path="/complaints" element={<ComplaintManagementPage />} />
                    <Route path="/food-management" element={<FoodManagementPage />} />
                    <Route path="/vacancies" element={<VacancyManagementPage />} />
                  </Route>

                  <Route element={<ProtectedRoute allowedRoles={["owner"]} />}>
                    <Route path="/owner" element={<OwnerDashboardPage />} />
                    <Route path="/owner/reports" element={<FinancialReportsPage />} />
                    <Route path="/owner/users" element={<UserAccessPage />} />
                    <Route path="/owner/settings" element={<PGSettingsPage />} />
                  </Route>

                  <Route element={<ProtectedRoute allowedRoles={["manager"]} />}>
                    <Route path="/manager" element={<ManagerDashboardPage />} />
                  </Route>

                  <Route element={<ProtectedRoute allowedRoles={["tenant"]} />}>
                    <Route path="/tenant" element={<MyProfilePage />} />
                    <Route path="/tenant/rent" element={<OnlineRentPage />} />
                    <Route path="/tenant/complaints" element={<TenantComplaintsPage />} />
                    <Route path="/tenant/food" element={<TenantFoodMenuPage />} />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
