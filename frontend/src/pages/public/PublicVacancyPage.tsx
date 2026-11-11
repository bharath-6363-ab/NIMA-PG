import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  BedDouble,
  Building2,
  Clock,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import brandMark from "@/assets/brand-mark.svg";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SearchInput, Select } from "@/components/ui/Input";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/shared/StateHelpers";
import { formatINR } from "@/lib/utils";
import { extractApiError } from "@/services/apiClient";
import {
  fetchPublicVacanciesDirectory,
  fetchPublicVacancyByToken,
} from "@/services/ownerService";
import {
  PublicVacancyDirectoryItem,
  PublicVacancyPage as PublicVacancyData,
} from "@/types/api";

export function PublicVacancyPage() {
  const { token } = useParams<{ token?: string }>();
  const [data, setData] = useState<PublicVacancyData | null>(null);
  const [directory, setDirectory] = useState<PublicVacancyDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"" | "vacant" | "notice_period">("");
  const [searchQuery, setSearchQuery] = useState("");

  const loadPublic = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (token) {
        const res = await fetchPublicVacancyByToken(token);
        setData(res);
      } else {
        const list = await fetchPublicVacanciesDirectory();
        setDirectory(list);
        if (list.length === 1) {
          setData(list[0]);
        }
      }
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPublic();
  }, [loadPublic]);

  return (
    <div className="min-h-screen bg-canvas text-slate-900">
      <header className="sticky top-0 z-20 border-b border-navy-800 bg-navy-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <img src={brandMark} alt="Aapka PG" className="h-8 w-8" />
            <div>
              <p className="text-sm font-semibold tracking-tight">Aapka PG</p>
              <p className="text-[11px] text-slate-400">Live Bed Availability</p>
            </div>
          </div>
          <Link to="/login">
            <Button
              size="sm"
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:border-white/30 hover:bg-white/15 hover:text-white"
            >
              Resident / Staff Login
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {loading ? (
          <DashboardSkeleton />
        ) : error ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<AlertCircle className="h-6 w-6 text-rose-500" />}
                title="Public vacancy listing unavailable"
                description={error}
              />
            </CardBody>
          </Card>
        ) : !data && directory.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<BedDouble className="h-6 w-6" />}
                title="No public vacancy listings active"
                description="Properties only appear here when an owner explicitly publishes a shareable vacancy link."
              />
            </CardBody>
          </Card>
        ) : !data && directory.length > 1 ? (
          <div className="space-y-5 animate-fade-in-up">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                Published PG Vacancy Listings
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Select a PG property to browse verified vacant and upcoming beds.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {directory.map((pg) => (
                <Card key={pg.share_token} interactive>
                  <CardBody className="space-y-3.5 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          {pg.pg_name}
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {pg.address}, {pg.city}
                        </p>
                      </div>
                      <Badge tone="info" className="capitalize">
                        {pg.gender_policy}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600">{pg.title}</p>
                    <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-xs font-semibold text-emerald-700">
                        {pg.vacant_beds_count} Vacant · {pg.notice_period_beds_count} Upcoming
                      </span>
                      <Link to={pg.share_path}>
                        <Button size="sm">View Available Beds</Button>
                      </Link>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        ) : data ? (
          <div className="space-y-6 animate-fade-in-up">
            {/* Property Showcase Banner (Crisp Architectural Navy) */}
            <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6 text-white shadow-card sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-blue-200">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{data.title}</span>
                    <span>·</span>
                    <span className="uppercase">{data.gender_policy} PG</span>
                  </div>
                  <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">
                    {data.pg_name}
                  </h1>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-300">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>
                      {data.address}, {data.city}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-center">
                    <p className="text-[11px] font-medium text-emerald-300">Vacant Now</p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                      {data.vacant_beds_count}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-center">
                    <p className="text-[11px] font-medium text-amber-200">Notice Period</p>
                    <p className="mt-0.5 text-2xl font-bold tabular-nums text-white">
                      {data.notice_period_beds_count}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 border-t border-white/10 pt-4 text-xs sm:grid-cols-2">
                <div className="flex items-start gap-2.5 text-slate-200">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <div>
                    <p className="font-semibold text-white">Included Amenities</p>
                    <p className="mt-0.5 text-slate-300">{data.amenities}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 text-slate-200">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                  <div>
                    <p className="font-semibold text-white">Meal Timings</p>
                    <p className="mt-0.5 text-slate-300">
                      Breakfast {data.breakfast_timing} · Lunch {data.lunch_timing} ·
                      Dinner {data.dinner_timing}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <Card>
              <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                <SearchInput
                  placeholder="Filter by room number, floor, or sharing type..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
                <Select
                  aria-label="Filter public beds by availability status"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as "" | "vacant" | "notice_period")
                  }
                >
                  <option value="">All Available &amp; Notice Beds</option>
                  <option value="vacant">Available Immediately (Vacant)</option>
                  <option value="notice_period">Upcoming Availability (Notice Period)</option>
                </Select>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Publicly Available Rooms & Beds"
                subtitle="Verified availability — contact the PG manager for an in-person tour"
                action={
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                    Resident Privacy Protected
                  </span>
                }
              />
              <CardBody>
                {(() => {
                  const filtered = data.available_beds.filter((b) => {
                    if (statusFilter && b.status !== statusFilter) return false;
                    if (searchQuery.trim()) {
                      const q = searchQuery.trim().toLowerCase();
                      const hay = `${b.room_number} ${b.bed_code} ${b.floor} ${b.sharing_type}`.toLowerCase();
                      if (!hay.includes(q)) return false;
                    }
                    return true;
                  });
                  if (filtered.length === 0) {
                    return (
                      <EmptyState
                        icon={<BedDouble className="h-5 w-5" />}
                        title="No matching public beds"
                        description="No publicly listed beds match your current filters."
                      />
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {filtered.map((bed) => (
                        <Card
                          key={bed.bed_code}
                          interactive
                          className="bg-slate-50/50 p-4"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                Room {bed.room_number} · Bed {bed.bed_code}
                              </p>
                              <p className="mt-0.5 text-xs capitalize text-slate-500">
                                {bed.sharing_type} Sharing · {bed.floor}
                              </p>
                            </div>
                            <Badge
                              tone={bed.status === "vacant" ? "success" : "warning"}
                              dot
                            >
                              {bed.status === "vacant" ? "Available" : "Notice Period"}
                            </Badge>
                          </div>
                          <div className="mt-4 flex items-baseline justify-between border-t border-slate-200/70 pt-3">
                            <div>
                              <span className="text-lg font-bold tabular-nums text-slate-900">
                                {formatINR(bed.monthly_rent)}
                              </span>
                              <span className="text-xs text-slate-500"> / month</span>
                            </div>
                            {bed.status === "vacant" ? (
                              <span className="text-[11px] font-medium text-slate-500">
                                Open {bed.days_vacant}d
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-amber-700">
                                Opening soon
                              </span>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  );
                })()}
              </CardBody>
            </Card>
          </div>
        ) : null}
      </main>
    </div>
  );
}
