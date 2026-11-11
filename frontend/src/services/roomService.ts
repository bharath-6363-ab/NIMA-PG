import { apiClient } from "@/services/apiClient";
import { BedDetail, BedStatus, RoomDetail, SharingType } from "@/types/api";

export async function listRooms(params?: {
  search?: string;
  availability?: string;
  include_inactive?: boolean;
}): Promise<RoomDetail[]> {
  const res = await apiClient.get<RoomDetail[]>("/api/rooms", { params });
  return res.data;
}

export async function getRoomDetail(roomId: number): Promise<RoomDetail> {
  const res = await apiClient.get<RoomDetail>(`/api/rooms/${roomId}`);
  return res.data;
}

export async function createRoom(payload: {
  room_number: string;
  floor: string;
  sharing_type: SharingType;
  max_capacity: number;
  description?: string;
  base_rent: string;
  food_charges?: string;
  auto_create_beds: boolean;
}): Promise<RoomDetail> {
  const res = await apiClient.post<RoomDetail>("/api/rooms", payload);
  return res.data;
}

export async function updateRoom(
  roomId: number,
  payload: {
    room_number?: string;
    floor?: string;
    sharing_type?: SharingType;
    max_capacity?: number;
    description?: string;
    base_rent?: string;
    is_active?: boolean;
  }
): Promise<RoomDetail> {
  const res = await apiClient.patch<RoomDetail>(`/api/rooms/${roomId}`, payload);
  return res.data;
}

export async function deleteRoom(roomId: number): Promise<void> {
  await apiClient.delete(`/api/rooms/${roomId}`);
}

export async function listBeds(params?: {
  room_id?: number;
  status?: BedStatus;
  search?: string;
}): Promise<BedDetail[]> {
  const res = await apiClient.get<BedDetail[]>("/api/beds", { params });
  return res.data;
}

export async function createBed(payload: {
  room_id: number;
  bed_label: string;
  monthly_rent: string;
  food_charges: string;
  status: BedStatus;
}): Promise<BedDetail> {
  const res = await apiClient.post<BedDetail>("/api/beds", payload);
  return res.data;
}

export async function updateBed(
  bedId: number,
  payload: {
    bed_label?: string;
    monthly_rent?: string;
    food_charges?: string;
    status?: BedStatus;
  }
): Promise<BedDetail> {
  const res = await apiClient.patch<BedDetail>(`/api/beds/${bedId}`, payload);
  return res.data;
}

export async function deleteBed(bedId: number): Promise<void> {
  await apiClient.delete(`/api/beds/${bedId}`);
}

