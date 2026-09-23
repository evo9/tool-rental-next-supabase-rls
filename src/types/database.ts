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
      customers: {
        Row: {
          category: Database["public"]["Enums"]["customer_category"]
          created_at: string
          document_photo_path: string | null
          full_name: string
          id: string
          phone: string
          photo_path: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["customer_category"]
          created_at?: string
          document_photo_path?: string | null
          full_name: string
          id?: string
          phone: string
          photo_path?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["customer_category"]
          created_at?: string
          document_photo_path?: string | null
          full_name?: string
          id?: string
          phone?: string
          photo_path?: string | null
        }
        Relationships: []
      }
      rental_items: {
        Row: {
          id: string
          issue_photo_path: string | null
          rental_id: string
          return_photo_path: string | null
          returned_at: string | null
          returned_by: string | null
          tool_unit_id: string
        }
        Insert: {
          id?: string
          issue_photo_path?: string | null
          rental_id: string
          return_photo_path?: string | null
          returned_at?: string | null
          returned_by?: string | null
          tool_unit_id: string
        }
        Update: {
          id?: string
          issue_photo_path?: string | null
          rental_id?: string
          return_photo_path?: string | null
          returned_at?: string | null
          returned_by?: string | null
          tool_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_items_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_items_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_items_tool_unit_id_fkey"
            columns: ["tool_unit_id"]
            isOneToOne: false
            referencedRelation: "tool_units"
            referencedColumns: ["id"]
          },
        ]
      }
      rentals: {
        Row: {
          closed_at: string | null
          created_by: string
          customer_id: string
          id: string
          issued_at: string
          note: string | null
          planned_return_at: string
          status: Database["public"]["Enums"]["rental_status"]
        }
        Insert: {
          closed_at?: string | null
          created_by?: string
          customer_id: string
          id?: string
          issued_at?: string
          note?: string | null
          planned_return_at: string
          status?: Database["public"]["Enums"]["rental_status"]
        }
        Update: {
          closed_at?: string | null
          created_by?: string
          customer_id?: string
          id?: string
          issued_at?: string
          note?: string | null
          planned_return_at?: string
          status?: Database["public"]["Enums"]["rental_status"]
        }
        Relationships: [
          {
            foreignKeyName: "rentals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rentals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          full_name: string
          is_active: boolean
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          user_id?: string
        }
        Relationships: []
      }
      tool_units: {
        Row: {
          created_at: string
          id: string
          inventory_number: string
          note: string | null
          status: Database["public"]["Enums"]["tool_unit_status"]
          tool_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_number: string
          note?: string | null
          status?: Database["public"]["Enums"]["tool_unit_status"]
          tool_id: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_number?: string
          note?: string | null
          status?: Database["public"]["Enums"]["tool_unit_status"]
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_units_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          created_at: string
          daily_rate: number
          deposit_value: number
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          daily_rate: number
          deposit_value: number
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          daily_rate?: number
          deposit_value?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      issue_rental: {
        Args: {
          p_customer_id: string
          p_planned_return_at: string
          p_unit_ids: string[]
        }
        Returns: {
          rental_id: string
          rental_item_id: string
          tool_unit_id: string
        }[]
      }
      return_rental_items: { Args: { p_items: Json }; Returns: undefined }
    }
    Enums: {
      customer_category: "PLATINUM" | "GOLD" | "SILVER" | "NON_GRATA"
      rental_status: "ACTIVE" | "CLOSED"
      staff_role: "OPERATOR" | "MANAGER" | "SUPERADMIN"
      tool_unit_status: "AVAILABLE" | "RENTED" | "UNAVAILABLE" | "WRITTEN_OFF"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      customer_category: ["PLATINUM", "GOLD", "SILVER", "NON_GRATA"],
      rental_status: ["ACTIVE", "CLOSED"],
      staff_role: ["OPERATOR", "MANAGER", "SUPERADMIN"],
      tool_unit_status: ["AVAILABLE", "RENTED", "UNAVAILABLE", "WRITTEN_OFF"],
    },
  },
} as const
