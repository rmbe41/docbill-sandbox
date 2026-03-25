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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      background_jobs: {
        Row: {
          id: string
          user_id: string
          conversation_id: string
          status: string
          sort_order: number
          payload: Json
          error: string | null
          progress_label: string | null
          progress_step: number | null
          progress_total: number | null
          created_at: string
          started_at: string | null
          finished_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          conversation_id: string
          status?: string
          sort_order?: number
          payload?: Json
          error?: string | null
          progress_label?: string | null
          progress_step?: number | null
          progress_total?: number | null
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          conversation_id?: string
          status?: string
          sort_order?: number
          payload?: Json
          error?: string | null
          progress_label?: string | null
          progress_step?: number | null
          progress_total?: number | null
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "background_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_context_files: {
        Row: {
          id: string
          filename: string
          content_text: string
          uploaded_by: string
          created_at: string
          storage_path: string | null
        }
        Insert: {
          id?: string
          filename: string
          content_text: string
          uploaded_by: string
          created_at?: string
          storage_path?: string | null
        }
        Update: {
          id?: string
          filename?: string
          content_text?: string
          uploaded_by?: string
          created_at?: string
          storage_path?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          marked_unread: boolean
          title: string
          updated_at: string
          user_id: string
          source_filename: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          marked_unread?: boolean
          title?: string
          updated_at?: string
          user_id: string
          source_filename?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          marked_unread?: boolean
          title?: string
          updated_at?: string
          user_id?: string
          source_filename?: string | null
        }
        Relationships: []
      }
      global_settings: {
        Row: {
          default_engine: string
          default_model: string
          default_rules: string
          id: string
          updated_at: string
        }
        Insert: {
          default_engine?: string
          default_model?: string
          default_rules?: string
          id?: string
          updated_at?: string
        }
        Update: {
          default_engine?: string
          default_model?: string
          default_rules?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          structured_content: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          structured_content?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          structured_content?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          custom_rules: string | null
          engine_type: string | null
          id: string
          praxis_stammdaten: Record<string, unknown> | null
          selected_model: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          custom_rules?: string | null
          engine_type?: string | null
          id?: string
          praxis_stammdaten?: Record<string, unknown> | null
          selected_model?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          custom_rules?: string | null
          engine_type?: string | null
          id?: string
          praxis_stammdaten?: Record<string, unknown> | null
          selected_model?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
