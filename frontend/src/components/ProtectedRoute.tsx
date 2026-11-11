import { Navigate, Outlet } from "react-router-dom";
import { LoadingState } from "@/components/shared/StateHelpers";
import { roleHomePath, useAuth } from "@/context/AuthContext";
import { UserRole } from "@/types/api";

export function ProtectedRoute({ allowedRoles }: { allowedRoles?: UserRole[] }) {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingState label="Validating session..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingState label="Checking authentication..." />
      </div>
    );
  }

  if (user) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }

  return <Outlet />;
}

