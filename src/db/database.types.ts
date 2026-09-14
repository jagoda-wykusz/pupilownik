export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      care_instructions: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_sensitive: boolean
          pet_id: string
          sort_order: number
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_sensitive?: boolean
          pet_id: string
          sort_order?: number
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_sensitive?: boolean
          pet_id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_instructions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      care_period_pets: {
        Row: {
          created_at: string
          period_id: string
          pet_id: string
        }
        Insert: {
          created_at?: string
          period_id: string
          pet_id: string
        }
        Update: {
          created_at?: string
          period_id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_period_pets_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "care_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_period_pets_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      care_periods: {
        Row: {
          caretaker_note: string | null
          created_at: string
          end_date: string
          id: string
          owner_id: string
          revoked_at: string | null
          start_date: string
          title: string
          token_digest: string
        }
        Insert: {
          caretaker_note?: string | null
          created_at?: string
          end_date: string
          id?: string
          owner_id: string
          revoked_at?: string | null
          start_date: string
          title: string
          token_digest: string
        }
        Update: {
          caretaker_note?: string | null
          created_at?: string
          end_date?: string
          id?: string
          owner_id?: string
          revoked_at?: string | null
          start_date?: string
          title?: string
          token_digest?: string
        }
        Relationships: []
      }
      care_slots: {
        Row: {
          claim_digest: string | null
          claimed_at: string | null
          claimed_by_name: string | null
          created_at: string
          id: string
          period_id: string
          slot_date: string
          time_of_day: Database["public"]["Enums"]["time_of_day"]
        }
        Insert: {
          claim_digest?: string | null
          claimed_at?: string | null
          claimed_by_name?: string | null
          created_at?: string
          id?: string
          period_id: string
          slot_date: string
          time_of_day: Database["public"]["Enums"]["time_of_day"]
        }
        Update: {
          claim_digest?: string | null
          claimed_at?: string | null
          claimed_by_name?: string | null
          created_at?: string
          id?: string
          period_id?: string
          slot_date?: string
          time_of_day?: Database["public"]["Enums"]["time_of_day"]
        }
        Relationships: [
          {
            foreignKeyName: "care_slots_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "care_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      pets: {
        Row: {
          age: string | null
          breed: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          species: Database["public"]["Enums"]["pet_species"]
          updated_at: string
        }
        Insert: {
          age?: string | null
          breed?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id: string
          species: Database["public"]["Enums"]["pet_species"]
          updated_at?: string
        }
        Update: {
          age?: string | null
          breed?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          species?: Database["public"]["Enums"]["pet_species"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_slots: {
        Args: {
          p_claim_secret: string
          p_name?: string
          p_slot_ids: string[]
          p_token: string
        }
        Returns: Json
      }
      create_period_with_slots: {
        Args: {
          p_caretaker_note?: string
          p_end_date: string
          p_pet_ids: string[]
          p_start_date: string
          p_title: string
          p_token_digest: string
        }
        Returns: {
          caretaker_note: string | null
          created_at: string
          end_date: string
          id: string
          owner_id: string
          revoked_at: string | null
          start_date: string
          title: string
          token_digest: string
        }
        SetofOptions: {
          from: "*"
          to: "care_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_pet_with_instructions: {
        Args: {
          p_age: string
          p_breed: string
          p_instructions: Json
          p_name: string
          p_species: Database["public"]["Enums"]["pet_species"]
        }
        Returns: {
          age: string | null
          breed: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          species: Database["public"]["Enums"]["pet_species"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_pet: { Args: { p_pet_id: string }; Returns: string }
      get_claimed_details: {
        Args: { p_claim_secret: string; p_token: string }
        Returns: Json
      }
      get_period_by_token: { Args: { p_token: string }; Returns: Json }
      regenerate_period_token: {
        Args: { p_period_id: string; p_token_digest: string }
        Returns: string
      }
      release_slot: {
        Args: { p_period_id: string; p_slot_id: string }
        Returns: string
      }
      revoke_period: { Args: { p_period_id: string }; Returns: string }
      update_pet_with_instructions: {
        Args: {
          p_age: string
          p_breed: string
          p_expected_updated_at: string
          p_instructions: Json
          p_name: string
          p_pet_id: string
          p_species: Database["public"]["Enums"]["pet_species"]
        }
        Returns: string
      }
    }
    Enums: {
      pet_species: "dog" | "cat" | "other"
      time_of_day: "morning" | "afternoon" | "evening"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      pet_species: ["dog", "cat", "other"],
      time_of_day: ["morning", "afternoon", "evening"],
    },
  },
} as const

