import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, Eye, LogOut, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ColumnDef, DataTable } from "@/components/ui/DataTable";
import { SearchInput, Select } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/shared/StateHelpers";
import { TenantStatusBadge } from "@/components/shared/StatusBadges";
import { useToast } from "@/components/shared/ToastProvider";
import { formatDate, formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import { listRooms } from "@/services/roomService";
import { listTenants } from "@/services/tenantMgmtService";
import { RoomDetail, TenantStatus, TenantSummary } from "@/types/api";

export function TenantsListPage() {
  const { showToast } = useToast();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [rooms, setRooms] = useState<RoomDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [roomFilter, setRoomFilter] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tList, rList] = await Promise.all([
        listTenants({
          status: (statusFilter as TenantStatus) || undefined,
          room_number: roomFilter || undefined,
          search: search.trim() || undefined,
        }),
        listRooms(),
      ]);
      setTenants(tList);
      setRooms(rList);
    } catch (err) {
      showToast("error", "Failed to load tenants", extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [roomFilter, search, showToast, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeCount = tenants.filter((t) => t.status === "active").length;
  const noticeCount = tenants.filter((t) => t.status === "notice_period").length;
  const checkedOutCount = tenants.filter((t) => t.status === "checked_out").length;

  const columns: ColumnDef<TenantSummary>[] = [
    {
      key: "tenant",
      header: "Resident",
      render: (t) => (
        <div>
          <p className="font-semibold text-slate-900">{t.full_name}</p>
          <p className="font-mono text-[11px] text-slate-500">{t.mobile}</p>
        </div>
      ),
    },
    {
      key: "allocation",
      header: "Room / Bed",
      render: (t) => (
        <div>
          <p className="font-medium text-slate-900">
            Room {t.room_number} · {t.bed_code}
          </p>
          <p className="text-[11px] text-slate-500">Joined {formatDate(t.joining_date)}</p>
        </div>
      ),
    },
    {
      key: "rent",
      header: "Rent + Food",
      align: "right",
      render: (t) => (
        <span className="text-xs font-medium text-slate-700">
          {formatINR(t.monthly_rent)} + {formatINR(t.food_charges)}
        </span>
      ),
    },
    {
      key: "deposit",
      header: "Deposit",
      align: "right",
      render: (t) => (
        <span className="font-medium text-slate-900">
          {formatINR(t.security_deposit_amount)}
        </span>
      ),
    },
    {
      key: "verification",
      header: "Verification",
      render: (t) => (
        <Badge
          tone={
            t.police_verification_status === "verified"
              ? "success"
              : t.police_verification_status === "pending"
                ? "warning"
                : "neutral"
          }
          dot
          className="capitalize"
        >
          {t.police_verification_status.replace("_", " ")}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <TenantStatusBadge status={t.status} />,
    },
    {
      key: "profile",
      header: "Profile",
      align: "right",
      render: (t) => (
        <Link to={`/tenants/${t.id}`}>
          <Button size="sm" variant="outline">
            <Eye className="h-3.5 w-3.5" />
            <span>View</span>
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Tenants" }]}
        title="Tenant Directory"
        subtitle="Search active, notice-period, and checked-out residents, inspect KYC documents, and manage checkouts."
        actions={
          <Link to="/tenants/new">
            <Button size="sm">
              <UserPlus className="h-4 w-4" />
              <span>Register Tenant</span>
            </Button>
          </Link>
        }
      />

      {loading && tenants.length === 0 ? (
        <>
          <StatGridSkeleton count={3} />
          <TableSkeleton rows={6} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Active Residents"
              value={activeCount}
              icon={CheckCircle2}
              tone="emerald"
            />
            <StatCard
              label="Notice Period"
              value={noticeCount}
              icon={Clock}
              tone="amber"
            />
            <StatCard
              label="Checked Out (History)"
              value={checkedOutCount}
              icon={LogOut}
              tone="neutral"
            />
          </div>

          <Card>
            <CardHeader
              title="All Residents"
              subtitle="Includes active, notice-period, and preserved historical records"
            />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <SearchInput
                  placeholder="Search name or mobile..."
                  value={search}
                  onChange={setSearch}
                />
                <Select
                  aria-label="Filter by tenant status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="notice_period">Notice Period</option>
                  <option value="checked_out">Checked Out</option>
                </Select>
                <Select
                  aria-label="Filter by room"
                  value={roomFilter}
                  onChange={(e) => setRoomFilter(e.target.value)}
                >
                  <option value="">All Rooms</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.room_number}>
                      Room {r.room_number}
                    </option>
                  ))}
                </Select>
              </div>

              {loading ? (
                <TableSkeleton rows={5} />
              ) : (
                <DataTable
                  columns={columns}
                  data={tenants}
                  rowKey={(t) => t.id}
                  emptyState={
                    <EmptyState
                      icon={<Users className="h-6 w-6" />}
                      title="No tenants found"
                      description="Register a new tenant onto a vacant bed or adjust your filters."
                      action={
                        <Link to="/tenants/new">
                          <Button>Register Tenant</Button>
                        </Link>
                      }
                    />
                  }
                />
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
