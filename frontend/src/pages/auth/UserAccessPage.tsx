import { FormEvent, useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, ShieldCheck, UserCheck, UserPlus, UserX } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { FieldLabel, Input, Select } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/shared/StateHelpers";
import { useToast } from "@/components/shared/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { formatDate } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  listPgUsers,
  registerUserAccount,
  updateUserAccount,
} from "@/services/authService";
import { AuthUser, UserRole } from "@/types/api";

export function UserAccessPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isOwner = user?.role === "owner";

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(isOwner);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>("tenant");

  const loadUsers = useCallback(async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      const rows = await listPgUsers();
      setUsers(rows);
    } catch (err) {
      showToast("error", "Failed to load users", extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [isOwner, showToast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await registerUserAccount({
        full_name: fullName,
        mobile,
        email: email.trim() || undefined,
        password,
        role: isOwner ? role : "tenant",
      });
      showToast(
        "success",
        "Account Created",
        `${created.full_name} registered as ${created.role}.`
      );
      setFullName("");
      setMobile("");
      setEmail("");
      setPassword("");
      setRole("tenant");
      if (isOwner) {
        await loadUsers();
      }
    } catch (err) {
      showToast("error", "Registration Failed", extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(target: AuthUser) {
    try {
      const updated = await updateUserAccount(target.id, {
        is_active: !target.is_active,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      showToast(
        "success",
        updated.is_active ? "User Activated" : "User Deactivated",
        `${updated.full_name} access updated.`
      );
    } catch (err) {
      showToast("error", "Update Failed", extractApiError(err));
    }
  }

  const columns: ColumnDef<AuthUser>[] = [
    {
      key: "user",
      header: "User",
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-900">{row.full_name}</p>
          <p className="text-[11px] text-slate-500">{row.email ?? "No email"}</p>
        </div>
      ),
    },
    {
      key: "mobile",
      header: "Mobile",
      render: (row) => (
        <span className="font-mono text-xs text-slate-700">{row.mobile}</span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge
          tone={
            row.role === "owner"
              ? "info"
              : row.role === "manager"
                ? "warning"
                : "neutral"
          }
          className="uppercase"
        >
          {row.role}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.is_active ? "success" : "error"} dot>
          {row.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (row) => (
        <span className="text-xs text-slate-500">{formatDate(row.created_at)}</span>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) =>
        row.id === user?.id ? (
          <span className="text-xs text-slate-400">Current Session</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleToggleActive(row)}
          >
            {row.is_active ? (
              <>
                <UserX className="h-3.5 w-3.5 text-rose-600" />
                <span>Deactivate</span>
              </>
            ) : (
              <>
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>Activate</span>
              </>
            )}
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Admin" }, { label: "Users & Managers" }]}
        title="Staff & User Access Control"
        subtitle="Onboard PG managers or resident accounts and manage role-isolated login access."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title={isOwner ? "Register Manager or Tenant" : "Onboard Tenant Account"}
            subtitle={
              isOwner
                ? "Controlled onboarding (Owners cannot be self-registered)"
                : "Managers can register tenant accounts only"
            }
            action={<UserPlus className="h-4 w-4 text-slate-400" />}
          />
          <CardBody>
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <FieldLabel htmlFor="reg-name" label="Full Name" required />
                <Input
                  id="reg-name"
                  placeholder="e.g. Ananya Rao"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <FieldLabel htmlFor="reg-mobile" label="Mobile Number" required />
                <Input
                  id="reg-mobile"
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  required
                />
              </div>

              <div>
                <FieldLabel htmlFor="reg-email" label="Email Address" hint="Optional" />
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel htmlFor="reg-pw" label="Initial Password" required />
                <div className="relative">
                  <Input
                    id="reg-pw"
                    type={showPassword ? "text" : "password"}
                    minLength={6}
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="reg-role" label="Assigned Role" required />
                {isOwner ? (
                  <Select
                    id="reg-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                  >
                    <option value="tenant">Tenant</option>
                    <option value="manager">Manager</option>
                  </Select>
                ) : (
                  <Input id="reg-role" value="Tenant (enforced by server)" disabled />
                )}
              </div>

              <Button type="submit" loading={submitting} className="w-full">
                Create User Account
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={isOwner ? "PG User & Role Directory" : "Role Access Policy"}
            subtitle={
              isOwner
                ? "Manage active status of Managers and Tenants"
                : "Server-enforced Manager permission scope"
            }
            action={<ShieldCheck className="h-4 w-4 text-slate-400" />}
          />
          {!isOwner ? (
            <CardBody>
              <EmptyState
                icon={<ShieldCheck className="h-6 w-6" />}
                title="Owner-Only User Directory"
                description="Managers can onboard new Tenant accounts on the left, while viewing and managing staff/all user accounts is restricted to the PG Owner (Malik)."
              />
            </CardBody>
          ) : loading ? (
            <CardBody>
              <TableSkeleton rows={5} />
            </CardBody>
          ) : (
            <DataTable
              columns={columns}
              data={users}
              rowKey={(r) => r.id}
              emptyState={
                <div className="p-5">
                  <EmptyState
                    icon={<UserCheck className="h-6 w-6" />}
                    title="No users found"
                    description="Register a manager or tenant account to view it here."
                  />
                </div>
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}
