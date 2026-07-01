export type MemberPosition = "SLT" | "EXCO" | "Junior";

export interface Member {
  id: string;
  name: string;
  display_name?: string | null;
  student_id: string;
  course: string;
  position: MemberPosition;
  schedule_raw: string | null;
  free_times: FreeTimes;
  birthday: string | null;
  created_at: string;
  updated_at: string;
}

export interface FreeTimes {
  Monday?: string[];
  Tuesday?: string[];
  Wednesday?: string[];
  Thursday?: string[];
  Friday?: string[];
}

export interface Schedule {
  id: string;
  name: string;
  schedule_type: "all" | "exco";
  status: "active" | "history";
  template_id: string | null;
  start_date: string | null;
  end_date: string | null;
  is_hidden: boolean;
  is_weekly?: boolean;
  default_positions: { name: string; max_members: number }[];
  created_by_role?: "admin" | "public";
  pin_hash?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeSlot {
  id: string;
  schedule_id: string;
  day_label: string;
  slot_date: string | null;
  time_start: string;
  time_end: string;
  duty: string | null;
  note: string | null;
  is_blocked: boolean;
  max_people: number;
  sort_order: number;
  created_at: string;
}

export interface SlotPosition {
  id: string;
  slot_id: string;
  position_name: string;
  max_members: number;
  sort_order: number;
  group_label?: string | null;
  programmes?: string | null;
  previous_classroom?: string | null;
  created_at: string;
}

export interface PositionConfig {
  name: string;
  max_members: number;
  group_label?: string | null;
  programmes?: string | null;
  previous_classroom?: string | null;
}

export interface ScheduleAssignment {
  id: string;
  slot_id: string;
  member_id: string;
  position_id: string | null;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  config: TemplateConfig;
  created_at: string;
  updated_at: string;
}

export interface TemplateConfig {
  // Day count is days.length. Labels are kept as a hint (date is dropped because
  // dates are calendar-specific and re-derived when the template is applied).
  days: { label: string; date?: string }[];
  // Legacy: a single shared list of time slots (applied to every day).
  time_slots: { time_start: string; time_end: string }[];
  // Per-day list of time slots (preferred when present). Index = day index.
  time_slots_per_day?: { time_start: string; time_end: string; duty?: string; note?: string }[][];
  // Default positions applied to every slot.
  default_positions?: PositionConfig[];
  // Per-slot positions snapshot. Key = `${day_label}|${slot_date}|${time_start}|${time_end}`.
  // When present and a slot's key matches, these positions are applied instead of default_positions.
  positions_by_slot_key?: Record<string, PositionConfig[]>;
  // Schedule type the template was saved for ("all" | "exco").
  schedule_type?: "all" | "exco";
  // Whether this template represents a recurring weekly schedule (Mon–Fri).
  is_weekly?: boolean;
  duties: string[];
}

export interface CustomField {
  id: string;
  field_name: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
}

export interface ExamPeriod {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}
