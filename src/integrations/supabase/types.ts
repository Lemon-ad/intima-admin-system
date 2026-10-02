export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      custom_fields: {
        Row: {
          created_at: string
          field_name: string
          field_type: string
          id: string
          is_required: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          field_name: string
          field_type?: string
          id?: string
          is_required?: boolean
          sort_order?: number
        }
        Update: {
          created_at?: string
          field_name?: string
          field_type?: string
          id?: string
          is_required?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      exam_periods: {
        Row: {
          created_at: string
          end_date: string
          id: string
          member_id: string
          note: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          member_id: string
          note?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          member_id?: string
          note?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_periods_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_custom_fields: {
        Row: {
          field_id: string
          id: string
          member_id: string
          value: string | null
        }
        Insert: {
          field_id: string
          id?: string
          member_id: string
          value?: string | null
        }
        Update: {
          field_id?: string
          id?: string
          member_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_custom_fields_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_custom_fields_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          birthday: string | null
          course: string
          created_at: string
          display_name: string | null
          free_times: Json | null
          id: string
          name: string
          position: Database["public"]["Enums"]["member_position"]
          schedule_raw: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          birthday?: string | null
          course: string
          created_at?: string
          display_name?: string | null
          free_times?: Json | null
          id?: string
          name: string
          position?: Database["public"]["Enums"]["member_position"]
          schedule_raw?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          birthday?: string | null
          course?: string
          created_at?: string
          display_name?: string | null
          free_times?: Json | null
          id?: string
          name?: string
          position?: Database["public"]["Enums"]["member_position"]
          schedule_raw?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          member_id: string
          p256dh: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          member_id: string
          p256dh: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          member_id?: string
          p256dh?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_assignments: {
        Row: {
          created_at: string
          id: string
          member_id: string
          position_id: string | null
          slot_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          position_id?: string | null
          slot_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          position_id?: string | null
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assignments_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "schedule_slot_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_assignments_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "schedule_time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_slot_positions: {
        Row: {
          created_at: string
          group_label: string | null
          id: string
          max_members: number
          position_name: string
          previous_classroom: string | null
          programmes: string | null
          slot_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_label?: string | null
          id?: string
          max_members?: number
          position_name?: string
          previous_classroom?: string | null
          programmes?: string | null
          slot_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_label?: string | null
          id?: string
          max_members?: number
          position_name?: string
          previous_classroom?: string | null
          programmes?: string | null
          slot_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_slot_positions_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "schedule_time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_time_slots: {
        Row: {
          created_at: string
          day_label: string
          duty: string | null
          id: string
          is_blocked: boolean
          max_people: number
          note: string | null
          schedule_id: string
          slot_date: string | null
          sort_order: number
          time_end: string
          time_start: string
        }
        Insert: {
          created_at?: string
          day_label: string
          duty?: string | null
          id?: string
          is_blocked?: boolean
          max_people?: number
          note?: string | null
          schedule_id: string
          slot_date?: string | null
          sort_order?: number
          time_end: string
          time_start: string
        }
        Update: {
          created_at?: string
          day_label?: string
          duty?: string | null
          id?: string
          is_blocked?: boolean
          max_people?: number
          note?: string | null
          schedule_id?: string
          slot_date?: string | null
          sort_order?: number
          time_end?: string
          time_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_time_slots_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          created_by_role: string
          default_positions: Json
          end_date: string | null
          id: string
          is_hidden: boolean
          is_weekly: boolean
          name: string
          pin_hash: string | null
          schedule_type: Database["public"]["Enums"]["schedule_type"]
          start_date: string | null
          status: Database["public"]["Enums"]["schedule_status"]
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_role?: string
          default_positions?: Json
          end_date?: string | null
          id?: string
          is_hidden?: boolean
          is_weekly?: boolean
          name: string
          pin_hash?: string | null
          schedule_type?: Database["public"]["Enums"]["schedule_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_role?: string
          default_positions?: Json
          end_date?: string | null
          id?: string
          is_hidden?: boolean
          is_weekly?: boolean
          name?: string
          pin_hash?: string | null
          schedule_type?: Database["public"]["Enums"]["schedule_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sent_push_log: {
        Row: {
          id: string
          reminder_key: string
          sent_at: string
          slot_id: string
          subscription_id: string
        }
        Insert: {
          id?: string
          reminder_key: string
          sent_at?: string
          slot_id: string
          subscription_id: string
        }
        Update: {
          id?: string
          reminder_key?: string
          sent_at?: string
          slot_id?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sent_push_log_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "schedule_time_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_push_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      sign_in_log: {
        Row: {
          created_at: string
          email: string
          id: string
          ip: string | null
          role: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip?: string | null
          role?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip?: string | null
          role?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      templates: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vapid_keys: {
        Row: {
          created_at: string
          id: string
          private_key: string
          public_key: string
          subject: string
        }
        Insert: {
          created_at?: string
          id?: string
          private_key: string
          public_key: string
          subject?: string
        }
        Update: {
          created_at?: string
          id?: string
          private_key?: string
          public_key?: string
          subject?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_id_by_email: { Args: { _email: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "public"
      member_position: "SLT" | "EXCO" | "Junior"
      schedule_status: "active" | "history"
      schedule_type: "all" | "exco"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "public"],
      member_position: ["SLT", "EXCO", "Junior"],
      schedule_status: ["active", "history"],
      schedule_type: ["all", "exco"],
    },
  },
} as const
