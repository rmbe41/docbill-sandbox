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
      batch_faelle: {
        Row: {
          id: string
          batch_id: string
          sort_order: number
          label: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          batch_id: string
          sort_order?: number
          label?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          batch_id?: string
          sort_order?: number
          label?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_faelle_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_rechnungen: {
        Row: {
          id: string
          batch_id: string
          fall_id: string
          sort_order: number
          patient_id_label: string
          betrag_euro: number
          liste_status: string
          hinweise_kurz: string | null
          fachbereich: string | null
          detail_json: Json
          vorschlaege_angenommen: boolean
          aenderungen_anzahl: number
          optimierung_angewendet_euro: number
        }
        Insert: {
          id?: string
          batch_id: string
          fall_id: string
          sort_order?: number
          patient_id_label: string
          betrag_euro?: number
          liste_status: string
          hinweise_kurz?: string | null
          fachbereich?: string | null
          detail_json?: Json
          vorschlaege_angenommen?: boolean
          aenderungen_anzahl?: number
          optimierung_angewendet_euro?: number
        }
        Update: {
          id?: string
          batch_id?: string
          fall_id?: string
          sort_order?: number
          patient_id_label?: string
          betrag_euro?: number
          liste_status?: string
          hinweise_kurz?: string | null
          fachbereich?: string | null
          detail_json?: Json
          vorschlaege_angenommen?: boolean
          aenderungen_anzahl?: number
          optimierung_angewendet_euro?: number
        }
        Relationships: [
          {
            foreignKeyName: "batch_rechnungen_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_rechnungen_fall_id_fkey"
            columns: ["fall_id"]
            isOneToOne: false
            referencedRelation: "batch_faelle"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          id: string
          user_id: string
          organisation_id: string
          name: string
          created_at: string
          updated_at: string
          rechnungen_count: number
          faelle_count: number
          verarbeitet_count: number
          status: string
          zusammenfassung: Json
        }
        Insert: {
          id?: string
          user_id: string
          organisation_id: string
          name: string
          created_at?: string
          updated_at?: string
          rechnungen_count?: number
          faelle_count?: number
          verarbeitet_count?: number
          status: string
          zusammenfassung?: Json
        }
        Update: {
          id?: string
          user_id?: string
          organisation_id?: string
          name?: string
          created_at?: string
          updated_at?: string
          rechnungen_count?: number
          faelle_count?: number
          verarbeitet_count?: number
          status?: string
          zusammenfassung?: Json
        }
        Relationships: []
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
      organisations: {
        Row: {
          id: string
          name: string
          typ: string
          plan: string
          settings: Json
          sso_config: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          typ?: string
          plan?: string
          settings?: Json
          sso_config?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          typ?: string
          plan?: string
          settings?: Json
          sso_config?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      organisation_members: {
        Row: {
          organisation_id: string
          user_id: string
          role: string
          fachgebiet: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          organisation_id: string
          user_id: string
          role?: string
          fachgebiet?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          organisation_id?: string
          user_id?: string
          role?: string
          fachgebiet?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      organisation_invites: {
        Row: {
          id: string
          organisation_id: string
          email: string
          role: string
          token: string
          expires_at: string
          invited_by: string
          created_at: string
          accepted_at: string | null
        }
        Insert: {
          id?: string
          organisation_id: string
          email: string
          role?: string
          token: string
          expires_at: string
          invited_by: string
          created_at?: string
          accepted_at?: string | null
        }
        Update: {
          id?: string
          organisation_id?: string
          email?: string
          role?: string
          token?: string
          expires_at?: string
          invited_by?: string
          created_at?: string
          accepted_at?: string | null
        }
        Relationships: []
      }
      kb_crawl_runs: {
        Row: {
          id: string
          source_name: string
          status: string
          started_at: string
          finished_at: string | null
          error_message: string | null
          document_count: number
          log: Json | null
        }
        Insert: {
          id?: string
          source_name?: string
          status?: string
          started_at?: string
          finished_at?: string | null
          error_message?: string | null
          document_count?: number
          log?: Json | null
        }
        Update: {
          id?: string
          source_name?: string
          status?: string
          started_at?: string
          finished_at?: string | null
          error_message?: string | null
          document_count?: number
          log?: Json | null
        }
        Relationships: []
      }
      kb_crawl_documents: {
        Row: {
          id: string
          run_id: string
          source_url: string
          content_hash: string | null
          text_extract: string | null
          byte_length: number | null
        }
        Insert: {
          id?: string
          run_id: string
          source_url: string
          content_hash?: string | null
          text_extract?: string | null
          byte_length?: number | null
        }
        Update: {
          id?: string
          run_id?: string
          source_url?: string
          content_hash?: string | null
          text_extract?: string | null
          byte_length?: number | null
        }
        Relationships: []
      }
      kb_beschluesse_review: {
        Row: {
          id: string
          external_key: string | null
          titel: string | null
          quelle: string | null
          relevanz_payload: Json | null
          aktion: string
          run_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
        }
        Insert: {
          id?: string
          external_key?: string | null
          titel?: string | null
          quelle?: string | null
          relevanz_payload?: Json | null
          aktion?: string
          run_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
        }
        Update: {
          id?: string
          external_key?: string | null
          titel?: string | null
          quelle?: string | null
          relevanz_payload?: Json | null
          aktion?: string
          run_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
        }
        Relationships: []
      }
      kb_relevanz_reports: {
        Row: {
          id: string
          week_start: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          week_start: string
          payload: Json
          created_at?: string
        }
        Update: {
          id?: string
          week_start?: string
          payload?: Json
          created_at?: string
        }
        Relationships: []
      }
      organisation_kommentar_files: {
        Row: {
          id: string
          organisation_id: string
          quelle: "brueck" | "hoffmann" | "lang_schaefer"
          filename: string
          content_text: string
          storage_path: string | null
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          quelle: "brueck" | "hoffmann" | "lang_schaefer"
          filename: string
          content_text: string
          storage_path?: string | null
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          quelle?: "brueck" | "hoffmann" | "lang_schaefer"
          filename?: string
          content_text?: string
          storage_path?: string | null
          uploaded_by?: string
          created_at?: string
        }
        Relationships: []
      }
      organisation_kommentar_chunks: {
        Row: {
          id: string
          organisation_id: string
          file_id: string
          filename: string
          chunk_index: number
          content: string
          ziffern: string[]
          source_page: number | null
          section_path: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organisation_id: string
          file_id: string
          filename: string
          chunk_index: number
          content: string
          ziffern?: string[]
          source_page?: number | null
          section_path?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organisation_id?: string
          file_id?: string
          filename?: string
          chunk_index?: number
          content?: string
          ziffern?: string[]
          source_page?: number | null
          section_path?: string | null
          created_at?: string
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
          organisation_id: string
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
          organisation_id: string
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
          organisation_id?: string
          source_filename?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
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
          kontext_wissen: boolean
          kurzantworten: boolean
          praxis_stammdaten: Record<string, unknown> | null
          selected_model: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          custom_rules?: string | null
          engine_type?: string | null
          id?: string
          kontext_wissen?: boolean
          kurzantworten?: boolean
          praxis_stammdaten?: Record<string, unknown> | null
          selected_model?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          custom_rules?: string | null
          engine_type?: string | null
          id?: string
          kontext_wissen?: boolean
          kurzantworten?: boolean
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
      list_organisation_member_directory: {
        Args: Record<string, never>
        Returns: {
          user_id: string
          role: string
          email: string
          created_at: string
        }[]
      }
      accept_organisation_invite: {
        Args: { p_token: string }
        Returns: Json
      }
      ensure_user_organisation: {
        Args: Record<string, never>
        Returns: string
      }
      get_organisation_context: {
        Args: Record<string, never>
        Returns: Json
      }
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
