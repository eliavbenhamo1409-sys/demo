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
      agents: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          phone: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          phone?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      day_closings: {
        Row: {
          closed_at: string
          day: string
          summary: Json
        }
        Insert: {
          closed_at?: string
          day: string
          summary: Json
        }
        Update: {
          closed_at?: string
          day?: string
          summary?: Json
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          customer: string | null
          id: string
          kind: Database["public"]["Enums"]["document_kind"]
          reference: string | null
          storage_path: string
          supplier_id: string | null
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          customer?: string | null
          id?: string
          kind: Database["public"]["Enums"]["document_kind"]
          reference?: string | null
          storage_path: string
          supplier_id?: string | null
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          customer?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          reference?: string | null
          storage_path?: string
          supplier_id?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      faults: {
        Row: {
          asset: string | null
          created_at: string
          description: string
          id: string
          movement_id: string | null
          photo_path: string | null
          product_id: string | null
          reported_by: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["fault_status"]
        }
        Insert: {
          asset?: string | null
          created_at?: string
          description: string
          id?: string
          movement_id?: string | null
          photo_path?: string | null
          product_id?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["fault_status"]
        }
        Update: {
          asset?: string | null
          created_at?: string
          description?: string
          id?: string
          movement_id?: string | null
          photo_path?: string | null
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
          document_id: string | null
          exit_pass: string | null
          external_name: string | null
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
          document_id?: string | null
          exit_pass?: string | null
          external_name?: string | null
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
          document_id?: string | null
          exit_pass?: string | null
          external_name?: string | null
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
      order_lines: {
        Row: {
          id: string
          movement_id: string | null
          order_id: string
          product_id: string
          qty: number
          unit_price: number | null
        }
        Insert: {
          id?: string
          movement_id?: string | null
          order_id: string
          product_id: string
          qty: number
          unit_price?: number | null
        }
        Update: {
          id?: string
          movement_id?: string | null
          order_id?: string
          product_id?: string
          qty?: number
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          agent_id: string
          closed_at: string | null
          created_at: string
          customer: string
          customer_phone: string | null
          id: string
          note: string | null
          number: number
          promised_on: string | null
          request_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          agent_id: string
          closed_at?: string | null
          created_at?: string
          customer: string
          customer_phone?: string | null
          id?: string
          note?: string | null
          number?: never
          promised_on?: string | null
          request_id: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          agent_id?: string
          closed_at?: string | null
          created_at?: string
          customer?: string
          customer_phone?: string | null
          id?: string
          note?: string | null
          number?: never
          promised_on?: string | null
          request_id?: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "orders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_path: string | null
          in_catalog: boolean
          location: string | null
          min_qty: number
          name: string
          notes: string | null
          price: number | null
          primary_supplier_id: string | null
          qty: number
          reserved: number
          sku: string
          unit: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          in_catalog?: boolean
          location?: string | null
          min_qty?: number
          name: string
          notes?: string | null
          price?: number | null
          primary_supplier_id?: string | null
          qty?: number
          reserved?: number
          sku: string
          unit?: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          in_catalog?: boolean
          location?: string | null
          min_qty?: number
          name?: string
          notes?: string | null
          price?: number | null
          primary_supplier_id?: string | null
          qty?: number
          reserved?: number
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
      item_requests: {
        Row: {
          document_id: string | null
          created_at: string
          customer: string | null
          external_name: string
          id: string
          kind: Database["public"]["Enums"]["item_request_kind"]
          movement_id: string | null
          normalized_name: string | null
          note: string | null
          product_id: string | null
          proposed_name: string | null
          qty: number
          reference: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["item_request_status"]
          worker_id: string | null
          worker_note: string | null
        }
        Insert: {
          document_id?: string | null
          created_at?: string
          customer?: string | null
          external_name: string
          id?: string
          kind: Database["public"]["Enums"]["item_request_kind"]
          movement_id?: string | null
          normalized_name?: string | null
          note?: string | null
          product_id?: string | null
          proposed_name?: string | null
          qty: number
          reference?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["item_request_status"]
          worker_id?: string | null
          worker_note?: string | null
        }
        Update: {
          document_id?: string | null
          created_at?: string
          customer?: string | null
          external_name?: string
          id?: string
          kind?: Database["public"]["Enums"]["item_request_kind"]
          movement_id?: string | null
          normalized_name?: string | null
          note?: string | null
          product_id?: string | null
          proposed_name?: string | null
          qty?: number
          reference?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["item_request_status"]
          worker_id?: string | null
          worker_note?: string | null
        }
        Relationships: []
      }
      supplier_items: {
        Row: {
          approved_at: string | null
          last_seen_at: string | null
          normalized_name: string | null
          times_seen: number
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
          approved_at?: string | null
          last_seen_at?: string | null
          normalized_name?: string | null
          times_seen?: number
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
          approved_at?: string | null
          last_seen_at?: string | null
          normalized_name?: string | null
          times_seen?: number
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
      warehouse_layout: {
        Row: {
          doc: Json
          id: string
          updated_at: string
          version: number
        }
        Insert: {
          doc: Json
          id?: string
          updated_at?: string
          version?: number
        }
        Update: {
          doc?: Json
          id?: string
          updated_at?: string
          version?: number
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
      approve_item_request: {
        Args: { request_id: string; target_product_id: string }
        Returns: Database["public"]["Tables"]["item_requests"]["Row"]
      }
      cancel_order: {
        Args: { target_order: string }
        Returns: Database["public"]["Tables"]["orders"]["Row"]
      }
      create_order: {
        Args: {
          agent: string
          customer_name: string
          items: Json
          order_note: string
          phone: string
          promised?: string
          request: string
        }
        Returns: Database["public"]["Tables"]["orders"]["Row"]
      }
      day_summary: { Args: { target: string }; Returns: Json }
      deliver_order: {
        Args: { by_worker?: string; receipt?: string; target_order: string }
        Returns: Database["public"]["Tables"]["orders"]["Row"]
      }
      deliver_order_no_receipt: {
        Args: { target_order: string; why: string }
        Returns: Database["public"]["Tables"]["orders"]["Row"]
      }
      ean13_check: { Args: { digits12: string }; Returns: string }
      normalize_name: { Args: { t: string }; Returns: string }
      recount_reserved: { Args: { ids: string[] }; Returns: undefined }
      remove_without_receipt: {
        Args: {
          amount: number
          by_worker?: string
          customer?: string
          kind: Database["public"]["Enums"]["movement_type"]
          product: string
          ref?: string
          why: string
        }
        Returns: undefined
      }
      super_admin_phone: { Args: never; Returns: string }
    }
    Enums: {
      document_kind: "in" | "out"
      fault_status: "open" | "resolved"
      item_request_kind: "unknown" | "new_product"
      item_request_status: "pending" | "approved" | "rejected"
      mapping_status: "approved" | "pending"
      movement_type: "in" | "out" | "fault" | "adjust"
      order_status: "open" | "delivered" | "cancelled"
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
      document_kind: ["in", "out"],
      fault_status: ["open", "resolved"],
      item_request_kind: ["unknown", "new_product"],
      item_request_status: ["pending", "approved", "rejected"],
      mapping_status: ["approved", "pending"],
      movement_type: ["in", "out", "fault", "adjust"],
      order_status: ["open", "delivered", "cancelled"],
    },
  },
} as const
