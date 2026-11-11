import { apiClient } from "@/services/apiClient";
import {
  DayOfWeek,
  FoodMenuSlot,
  ManagerFoodOverview,
  MealRatingItem,
  MealSkipItem,
  MealType,
  TenantFoodOverview,
} from "@/types/api";

export async function fetchTenantFoodOverview(): Promise<TenantFoodOverview> {
  const res = await apiClient.get<TenantFoodOverview>("/api/food/tenant");
  return res.data;
}

export async function submitMealSkip(payload: {
  skip_date: string;
  meal_type: MealType;
  reason?: string;
}): Promise<MealSkipItem> {
  const res = await apiClient.post<MealSkipItem>("/api/food/skips", payload);
  return res.data;
}

export async function cancelMealSkip(skipId: number): Promise<void> {
  await apiClient.post(`/api/food/skips/${skipId}/cancel`);
}

export async function submitMealRating(payload: {
  meal_date: string;
  meal_type: MealType;
  rating: number;
  comment?: string;
}): Promise<MealRatingItem> {
  const res = await apiClient.post<MealRatingItem>("/api/food/ratings", payload);
  return res.data;
}

export async function fetchManagerFoodOverview(
  targetDate?: string
): Promise<ManagerFoodOverview> {
  const res = await apiClient.get<ManagerFoodOverview>("/api/food/manager", {
    params: targetDate ? { target_date: targetDate } : undefined,
  });
  return res.data;
}

export interface MenuSlotInput {
  day_of_week: DayOfWeek;
  meal_type: MealType;
  meal_name?: string;
  description?: string | null;
  items_description?: string;
  menu_items?: { item_name: string; is_veg: boolean }[];
  timing_label: string;
  is_available: boolean;
  is_published: boolean;
}

export async function saveWeeklyFoodMenu(
  slots: MenuSlotInput[]
): Promise<FoodMenuSlot[]> {
  const res = await apiClient.put<FoodMenuSlot[]>("/api/food/menu", { slots });
  return res.data;
}

export async function updateSingleFoodSlot(
  menuId: number,
  payload: Partial<Omit<MenuSlotInput, "day_of_week" | "meal_type">>
): Promise<FoodMenuSlot> {
  const res = await apiClient.patch<FoodMenuSlot>(`/api/food/menu/${menuId}`, payload);
  return res.data;
}

export async function uploadFoodSlotImage(
  menuId: number,
  file: File
): Promise<FoodMenuSlot> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post<FoodMenuSlot>(
    `/api/food/menu/${menuId}/image`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return res.data;
}

export async function setWeeklyMenuPublishState(
  isPublished: boolean
): Promise<FoodMenuSlot[]> {
  const res = await apiClient.post<FoodMenuSlot[]>("/api/food/menu/publish", {
    is_published: isPublished,
  });
  return res.data;
}

