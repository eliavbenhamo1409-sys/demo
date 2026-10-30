export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      faults: {
        Row: {
          created_at: string
          description: string
          id: string
          movement_id: string | null
          product_id: string | null
          reported_by: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["fault_status"]
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          movement_id?: string | null
          product_id?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["fault_status"]
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          movement_id?: string | null
          product_id?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["fault_status"]
        }
        Relationships: [
          {
            foreignKeyName: "faults_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faults_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faults_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      movements: {
        Row: {
          created_at: string
          id: string
          note: string | null
          product_id: string
          qty: number
          reference: string | null
          supplier_id: string | null
          type: Database["public"]["Enums"]["movement_type"]
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          product_id: string
          qty: number
          reference?: string | null
          supplier_id?: string | null
          type: Database["public"]["Enums"]["movement_type"]
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string
          qty?: number
          reference?: string | null
          supplier_id?: string | null
          type?: Database["public"]["Enums"]["movement_type"]
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          id: string
          location: string | null
          min_qty: number
          name: string
          notes: string | null
          primary_supplier_id: string | null
          qty: number
          sku: string
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          min_qty?: number
          name: string
          notes?: string | null
          primary_supplier_id?: string | null
          qty?: number
          sku: string
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          location?: string | null
          min_qty?: number
          name?: string
          notes?: string | null
          primary_supplier_id?: string | null
          qty?: number
          sku?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_primary_supplier_id_fkey"
            columns: ["primary_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_items: {
        Row: {
          created_at: string
          external_name: string
          external_sku: string | null
          id: string
          product_id: string | null
          status: Database["public"]["Enums"]["mapping_status"]
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_name: string
          external_sku?: string | null
          id?: string
          product_id?: string | null
          status?: Database["public"]["Enums"]["mapping_status"]
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_name?: string
          external_sku?: string | null
          id?: string
          product_id?: string | null
          status?: Database["public"]["Enums"]["mapping_status"]
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      workers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          role: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          role?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          role?: string
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
      fault_status: "open" | "resolved"
      mapping_status: "approved" | "pending"
      movement_type: "in" | "out" | "fault" | "adjust"
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

export const Constants = {
  public: {
    Enums: {
      fault_status: ["open", "resolved"],
      mapping_status: ["approved", "pending"],
      movement_type: ["in", "out", "fault", "adjust"],
    },
  },
} as const
