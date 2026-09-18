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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      ai_activity_log: {
        Row: {
          created_at: string
          edited_fields: string[] | null
          feature: string
          id: string
          latency_ms: number | null
          model: string | null
          output: Json | null
          raw_input: string | null
          resolution: string
          team_member_id: string | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          created_at?: string
          edited_fields?: string[] | null
          feature: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          output?: Json | null
          raw_input?: string | null
          resolution?: string
          team_member_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          created_at?: string
          edited_fields?: string[] | null
          feature?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          output?: Json | null
          raw_input?: string | null
          resolution?: string
          team_member_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_activity_log_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      appeals: {
        Row: {
          campaign_id: string | null
          channel: string | null
          id: string
          is_active: boolean
          name: string
          year: number | null
        }
        Insert: {
          campaign_id?: string | null
          channel?: string | null
          id?: string
          is_active?: boolean
          name: string
          year?: number | null
        }
        Update: {
          campaign_id?: string | null
          channel?: string | null
          id?: string
          is_active?: boolean
          name?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appeals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: number
          new_values: Json | null
          old_values: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          is_enabled: boolean
          params: Json
          rule_key: string
          updated_at: string
        }
        Insert: {
          is_enabled?: boolean
          params?: Json
          rule_key: string
          updated_at?: string
        }
        Update: {
          is_enabled?: boolean
          params?: Json
          rule_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          created_at: string
          description: string | null
          ends_on: string | null
          goal_amount: number | null
          id: string
          is_active: boolean
          name: string
          starts_on: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          ends_on?: string | null
          goal_amount?: number | null
          id?: string
          is_active?: boolean
          name: string
          starts_on?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          ends_on?: string | null
          goal_amount?: number | null
          id?: string
          is_active?: boolean
          name?: string
          starts_on?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          assistant_contact: string | null
          assistant_name: string | null
          best_time_to_contact: string | null
          birthday: string | null
          city: string | null
          contact_frequency_days: number | null
          contact_kind: string
          country: string | null
          created_at: string
          created_by: string | null
          email: string | null
          engagement_computed_at: string | null
          engagement_score: number | null
          engagement_tier: string
          estimated_capacity: number | null
          family_notes: string | null
          first_name: string
          ga_house_no: string | null
          hebrew_name: string | null
          household_id: string | null
          id: string
          industry: string | null
          introduced_by_id: string | null
          introduced_by_note: string | null
          is_archived: boolean
          is_organisation_self: boolean
          kit_paused_until: string | null
          known_since: string | null
          last_name: string
          linkedin_url: string | null
          merged_into_id: string | null
          mutual_connections: string | null
          organization: string | null
          phone: string | null
          photo_url: string | null
          pinned_note_id: string | null
          position: string | null
          postcode: string | null
          preferred_channel: string | null
          preferred_language: string
          priority: string
          relationship_owner_id: string | null
          relationship_strength: number | null
          source: string | null
          spouse_name: string | null
          stage: string
          things_to_remember: string | null
          tier: string | null
          title: string | null
          updated_at: string
          website_url: string | null
          whatsapp: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          assistant_contact?: string | null
          assistant_name?: string | null
          best_time_to_contact?: string | null
          birthday?: string | null
          city?: string | null
          contact_frequency_days?: number | null
          contact_kind?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          engagement_computed_at?: string | null
          engagement_score?: number | null
          engagement_tier?: string
          estimated_capacity?: number | null
          family_notes?: string | null
          first_name: string
          ga_house_no?: string | null
          hebrew_name?: string | null
          household_id?: string | null
          id?: string
          industry?: string | null
          introduced_by_id?: string | null
          introduced_by_note?: string | null
          is_archived?: boolean
          is_organisation_self?: boolean
          kit_paused_until?: string | null
          known_since?: string | null
          last_name?: string
          linkedin_url?: string | null
          merged_into_id?: string | null
          mutual_connections?: string | null
          organization?: string | null
          phone?: string | null
          photo_url?: string | null
          pinned_note_id?: string | null
          position?: string | null
          postcode?: string | null
          preferred_channel?: string | null
          preferred_language?: string
          priority?: string
          relationship_owner_id?: string | null
          relationship_strength?: number | null
          source?: string | null
          spouse_name?: string | null
          stage?: string
          things_to_remember?: string | null
          tier?: string | null
          title?: string | null
          updated_at?: string
          website_url?: string | null
          whatsapp?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          assistant_contact?: string | null
          assistant_name?: string | null
          best_time_to_contact?: string | null
          birthday?: string | null
          city?: string | null
          contact_frequency_days?: number | null
          contact_kind?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          engagement_computed_at?: string | null
          engagement_score?: number | null
          engagement_tier?: string
          estimated_capacity?: number | null
          family_notes?: string | null
          first_name?: string
          ga_house_no?: string | null
          hebrew_name?: string | null
          household_id?: string | null
          id?: string
          industry?: string | null
          introduced_by_id?: string | null
          introduced_by_note?: string | null
          is_archived?: boolean
          is_organisation_self?: boolean
          kit_paused_until?: string | null
          known_since?: string | null
          last_name?: string
          linkedin_url?: string | null
          merged_into_id?: string | null
          mutual_connections?: string | null
          organization?: string | null
          phone?: string | null
          photo_url?: string | null
          pinned_note_id?: string | null
          position?: string | null
          postcode?: string | null
          preferred_channel?: string | null
          preferred_language?: string
          priority?: string
          relationship_owner_id?: string | null
          relationship_strength?: number | null
          source?: string | null
          spouse_name?: string | null
          stage?: string
          things_to_remember?: string | null
          tier?: string | null
          title?: string | null
          updated_at?: string
          website_url?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_introduced_by_id_fkey"
            columns: ["introduced_by_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "contacts_introduced_by_id_fkey"
            columns: ["introduced_by_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "contacts_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_pinned_note_fk"
            columns: ["pinned_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_relationship_owner_id_fkey"
            columns: ["relationship_owner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          kind: string | null
          storage_path: string | null
          title: string
          uploaded_by: string | null
          url: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          kind?: string | null
          storage_path?: string | null
          title: string
          uploaded_by?: string | null
          url?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          kind?: string | null
          storage_path?: string | null
          title?: string
          uploaded_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      donations: {
        Row: {
          amount: number
          amount_gbp: number
          appeal_id: string | null
          campaign_id: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          currency: string
          donated_on: string
          fund_id: string
          gift_aid_claim_id: string | null
          gift_aid_status: string
          id: string
          installment_id: string | null
          is_gasds: boolean
          notes: string | null
          payment_method: string | null
          pledge_id: string | null
          receipt_pref: string | null
          receipt_status: string
          recurring_agreement_id: string | null
          status: string
          thank_you_status: string
        }
        Insert: {
          amount: number
          amount_gbp: number
          appeal_id?: string | null
          campaign_id?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          donated_on: string
          fund_id: string
          gift_aid_claim_id?: string | null
          gift_aid_status?: string
          id?: string
          installment_id?: string | null
          is_gasds?: boolean
          notes?: string | null
          payment_method?: string | null
          pledge_id?: string | null
          receipt_pref?: string | null
          receipt_status?: string
          recurring_agreement_id?: string | null
          status?: string
          thank_you_status?: string
        }
        Update: {
          amount?: number
          amount_gbp?: number
          appeal_id?: string | null
          campaign_id?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          donated_on?: string
          fund_id?: string
          gift_aid_claim_id?: string | null
          gift_aid_status?: string
          id?: string
          installment_id?: string | null
          is_gasds?: boolean
          notes?: string | null
          payment_method?: string | null
          pledge_id?: string | null
          receipt_pref?: string | null
          receipt_status?: string
          recurring_agreement_id?: string | null
          status?: string
          thank_you_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "donations_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "appeals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "donations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_gift_aid_claim_id_fkey"
            columns: ["gift_aid_claim_id"]
            isOneToOne: false
            referencedRelation: "gift_aid_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "pledge_balances"
            referencedColumns: ["next_installment_id"]
          },
          {
            foreignKeyName: "donations_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "pledge_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_pledge_id_fkey"
            columns: ["pledge_id"]
            isOneToOne: false
            referencedRelation: "pledge_balances"
            referencedColumns: ["pledge_id"]
          },
          {
            foreignKeyName: "donations_pledge_id_fkey"
            columns: ["pledge_id"]
            isOneToOne: false
            referencedRelation: "pledges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_recurring_agreement_id_fkey"
            columns: ["recurring_agreement_id"]
            isOneToOne: false
            referencedRelation: "recurring_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicates_queue: {
        Row: {
          contact_a_id: string
          contact_b_id: string
          created_at: string
          id: string
          reason: string
          score: number | null
          state: string
        }
        Insert: {
          contact_a_id: string
          contact_b_id: string
          created_at?: string
          id?: string
          reason: string
          score?: number | null
          state?: string
        }
        Update: {
          contact_a_id?: string
          contact_b_id?: string
          created_at?: string
          id?: string
          reason?: string
          score?: number | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "duplicates_queue_contact_a_id_fkey"
            columns: ["contact_a_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "duplicates_queue_contact_a_id_fkey"
            columns: ["contact_a_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicates_queue_contact_b_id_fkey"
            columns: ["contact_b_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "duplicates_queue_contact_b_id_fkey"
            columns: ["contact_b_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      funds: {
        Row: {
          code: string | null
          id: string
          is_active: boolean
          is_restricted: boolean
          name: string
        }
        Insert: {
          code?: string | null
          id?: string
          is_active?: boolean
          is_restricted?: boolean
          name: string
        }
        Update: {
          code?: string | null
          id?: string
          is_active?: boolean
          is_restricted?: boolean
          name?: string
        }
        Relationships: []
      }
      gift_aid_claims: {
        Row: {
          created_at: string
          gasds_total: number | null
          hmrc_reference: string | null
          id: string
          status: string
          submitted_on: string | null
          total_claimed: number | null
          total_donations: number | null
        }
        Insert: {
          created_at?: string
          gasds_total?: number | null
          hmrc_reference?: string | null
          id?: string
          status?: string
          submitted_on?: string | null
          total_claimed?: number | null
          total_donations?: number | null
        }
        Update: {
          created_at?: string
          gasds_total?: number | null
          hmrc_reference?: string | null
          id?: string
          status?: string
          submitted_on?: string | null
          total_claimed?: number | null
          total_donations?: number | null
        }
        Relationships: []
      }
      gift_aid_declarations: {
        Row: {
          cancelled_on: string | null
          contact_id: string
          covers_from: string | null
          covers_future: boolean
          covers_past: boolean
          created_at: string
          declared_on: string
          evidence_url: string | null
          id: string
          method: string
          oral_confirmation_sent_on: string | null
          wording_version: string | null
        }
        Insert: {
          cancelled_on?: string | null
          contact_id: string
          covers_from?: string | null
          covers_future?: boolean
          covers_past?: boolean
          created_at?: string
          declared_on: string
          evidence_url?: string | null
          id?: string
          method: string
          oral_confirmation_sent_on?: string | null
          wording_version?: string | null
        }
        Update: {
          cancelled_on?: string | null
          contact_id?: string
          covers_from?: string | null
          covers_future?: boolean
          covers_past?: boolean
          created_at?: string
          declared_on?: string
          evidence_url?: string | null
          id?: string
          method?: string
          oral_confirmation_sent_on?: string | null
          wording_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_aid_declarations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "gift_aid_declarations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          formal_greeting: string | null
          greeting_is_override: boolean
          hebrew_greeting: string | null
          id: string
          informal_greeting: string | null
          name: string | null
          name_is_override: boolean
          primary_contact_id: string | null
        }
        Insert: {
          created_at?: string
          formal_greeting?: string | null
          greeting_is_override?: boolean
          hebrew_greeting?: string | null
          id?: string
          informal_greeting?: string | null
          name?: string | null
          name_is_override?: boolean
          primary_contact_id?: string | null
        }
        Update: {
          created_at?: string
          formal_greeting?: string | null
          greeting_is_override?: boolean
          hebrew_greeting?: string | null
          id?: string
          informal_greeting?: string | null
          name?: string | null
          name_is_override?: boolean
          primary_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "households_primary_contact_fk"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "households_primary_contact_fk"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          ai_activity_id: string | null
          ai_raw_input: string | null
          ask_amount: number | null
          attendees: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          id: string
          is_meaningful: boolean
          kind: string
          location: string | null
          occurred_at: string
          outcome: string | null
          purpose: string | null
          source: string
          status: string
          summary: string
          team_member_id: string | null
        }
        Insert: {
          ai_activity_id?: string | null
          ai_raw_input?: string | null
          ask_amount?: number | null
          attendees?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_meaningful?: boolean
          kind: string
          location?: string | null
          occurred_at: string
          outcome?: string | null
          purpose?: string | null
          source?: string
          status?: string
          summary: string
          team_member_id?: string | null
        }
        Update: {
          ai_activity_id?: string | null
          ai_raw_input?: string | null
          ask_amount?: number | null
          attendees?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_meaningful?: boolean
          kind?: string
          location?: string | null
          occurred_at?: string
          outcome?: string | null
          purpose?: string | null
          source?: string
          status?: string
          summary?: string
          team_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interactions_ai_activity_id_fkey"
            columns: ["ai_activity_id"]
            isOneToOne: false
            referencedRelation: "ai_activity_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      lookup_options: {
        Row: {
          color: string | null
          id: string
          is_active: boolean
          label: string
          list_name: string
          meta: Json
          sort_order: number
          value: string
        }
        Insert: {
          color?: string | null
          id?: string
          is_active?: boolean
          label: string
          list_name: string
          meta?: Json
          sort_order?: number
          value: string
        }
        Update: {
          color?: string | null
          id?: string
          is_active?: boolean
          label?: string
          list_name?: string
          meta?: Json
          sort_order?: number
          value?: string
        }
        Relationships: []
      }
      nightly_runs: {
        Row: {
          counts: Json
          error: string | null
          finished_at: string | null
          id: number
          ok: boolean
          started_at: string
        }
        Insert: {
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: never
          ok?: boolean
          started_at?: string
        }
        Update: {
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: never
          ok?: boolean
          started_at?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          body: string
          category: string | null
          contact_id: string
          created_at: string
          created_by: string
          id: string
          is_pinned: boolean
          is_private: boolean
        }
        Insert: {
          body: string
          category?: string | null
          contact_id: string
          created_at?: string
          created_by: string
          id?: string
          is_pinned?: boolean
          is_private?: boolean
        }
        Update: {
          body?: string
          category?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_pinned?: boolean
          is_private?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          ask_amount: number | null
          ask_date: string | null
          campaign_id: string | null
          closed_on: string | null
          contact_id: string
          created_at: string
          expected_amount: number | null
          expected_decision_on: string | null
          fund_id: string | null
          id: string
          last_moved_forward_at: string | null
          motivation: string | null
          name: string
          notes: string | null
          opened_on: string
          probability_pct: number | null
          projection_high: number | null
          projection_low: number | null
          restrictions: string | null
          stage: string
          stage_entered_at: string
          status: string
        }
        Insert: {
          ask_amount?: number | null
          ask_date?: string | null
          campaign_id?: string | null
          closed_on?: string | null
          contact_id: string
          created_at?: string
          expected_amount?: number | null
          expected_decision_on?: string | null
          fund_id?: string | null
          id?: string
          last_moved_forward_at?: string | null
          motivation?: string | null
          name: string
          notes?: string | null
          opened_on?: string
          probability_pct?: number | null
          projection_high?: number | null
          projection_low?: number | null
          restrictions?: string | null
          stage?: string
          stage_entered_at?: string
          status?: string
        }
        Update: {
          ask_amount?: number | null
          ask_date?: string | null
          campaign_id?: string | null
          closed_on?: string | null
          contact_id?: string
          created_at?: string
          expected_amount?: number | null
          expected_decision_on?: string | null
          fund_id?: string | null
          id?: string
          last_moved_forward_at?: string | null
          motivation?: string | null
          name?: string
          notes?: string | null
          opened_on?: string
          probability_pct?: number | null
          projection_high?: number | null
          projection_low?: number | null
          restrictions?: string | null
          stage?: string
          stage_entered_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
        ]
      }
      pledge_installments: {
        Row: {
          amount: number
          due_on: string
          id: string
          pledge_id: string
          status: string
        }
        Insert: {
          amount: number
          due_on: string
          id?: string
          pledge_id: string
          status?: string
        }
        Update: {
          amount?: number
          due_on?: string
          id?: string
          pledge_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pledge_installments_pledge_id_fkey"
            columns: ["pledge_id"]
            isOneToOne: false
            referencedRelation: "pledge_balances"
            referencedColumns: ["pledge_id"]
          },
          {
            foreignKeyName: "pledge_installments_pledge_id_fkey"
            columns: ["pledge_id"]
            isOneToOne: false
            referencedRelation: "pledges"
            referencedColumns: ["id"]
          },
        ]
      }
      pledges: {
        Row: {
          amount_gbp: number
          appeal_id: string | null
          campaign_id: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          currency: string
          fund_id: string | null
          id: string
          notes: string | null
          pledged_on: string
          status: string
          total_amount: number
          write_off_amount: number | null
        }
        Insert: {
          amount_gbp: number
          appeal_id?: string | null
          campaign_id?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          fund_id?: string | null
          id?: string
          notes?: string | null
          pledged_on: string
          status?: string
          total_amount: number
          write_off_amount?: number | null
        }
        Update: {
          amount_gbp?: number
          appeal_id?: string | null
          campaign_id?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          fund_id?: string | null
          id?: string
          notes?: string | null
          pledged_on?: string
          status?: string
          total_amount?: number
          write_off_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pledges_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "appeals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "pledges_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_agreements: {
        Row: {
          amount: number
          contact_id: string
          created_at: string
          currency: string
          ends_on: string | null
          expected_day: number | null
          frequency: string
          fund_id: string | null
          id: string
          last_payment_on: string | null
          missed_count: number
          payment_method: string | null
          starts_on: string
          status: string
        }
        Insert: {
          amount: number
          contact_id: string
          created_at?: string
          currency?: string
          ends_on?: string | null
          expected_day?: number | null
          frequency: string
          fund_id?: string | null
          id?: string
          last_payment_on?: string | null
          missed_count?: number
          payment_method?: string | null
          starts_on: string
          status?: string
        }
        Update: {
          amount?: number
          contact_id?: string
          created_at?: string
          currency?: string
          ends_on?: string | null
          expected_day?: number | null
          frequency?: string
          fund_id?: string | null
          id?: string
          last_payment_on?: string | null
          missed_count?: number
          payment_method?: string | null
          starts_on?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_agreements_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "recurring_agreements_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_agreements_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          columns: string[]
          created_at: string
          entity: string
          filters: Json
          group_by: string | null
          icon: string | null
          id: string
          is_shared: boolean
          layout: string
          name: string
          owner_id: string | null
          sort: Json
        }
        Insert: {
          columns?: string[]
          created_at?: string
          entity: string
          filters?: Json
          group_by?: string | null
          icon?: string | null
          id?: string
          is_shared?: boolean
          layout?: string
          name: string
          owner_id?: string | null
          sort?: Json
        }
        Update: {
          columns?: string[]
          created_at?: string
          entity?: string
          filters?: Json
          group_by?: string | null
          icon?: string | null
          id?: string
          is_shared?: boolean
          layout?: string
          name?: string
          owner_id?: string | null
          sort?: Json
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          contact_id: string
          created_at: string
          dedupe_key: string
          id: string
          reason: string
          resolved_at: string | null
          rule_key: string
          snoozed_until: string | null
          state: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          dedupe_key: string
          id?: string
          reason: string
          resolved_at?: string | null
          rule_key: string
          snoozed_until?: string | null
          state?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          reason?: string
          resolved_at?: string | null
          rule_key?: string
          snoozed_until?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "signals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      soft_credits: {
        Row: {
          amount: number | null
          contact_id: string
          created_by: string | null
          donation_id: string
          id: string
          role: string
        }
        Insert: {
          amount?: number | null
          contact_id: string
          created_by?: string | null
          donation_id: string
          id?: string
          role: string
        }
        Update: {
          amount?: number | null
          contact_id?: string
          created_by?: string | null
          donation_id?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "soft_credits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "soft_credits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soft_credits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soft_credits_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soft_credits_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: false
            referencedRelation: "donations_redacted"
            referencedColumns: ["id"]
          },
        ]
      }
      taggings: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          is_excluded: boolean
          note: string | null
          since: string | null
          tag_id: string
          until: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          is_excluded?: boolean
          note?: string | null
          since?: string | null
          tag_id: string
          until?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          is_excluded?: boolean
          note?: string | null
          since?: string | null
          tag_id?: string
          until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "taggings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "taggings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "taggings_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          auto_rule: Json | null
          category: string
          color: string | null
          id: string
          is_auto: boolean
          name: string
        }
        Insert: {
          auto_rule?: Json | null
          category?: string
          color?: string | null
          id?: string
          is_auto?: boolean
          name: string
        }
        Update: {
          auto_rule?: Json | null
          category?: string
          color?: string | null
          id?: string
          is_auto?: boolean
          name?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          action_type: string | null
          assigned_to: string | null
          completed_at: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          details: string | null
          due_on: string | null
          id: string
          opportunity_id: string | null
          origin: string
          priority: string
          queue_order: number | null
          status: string
          title: string
          waiting_for: string | null
        }
        Insert: {
          action_type?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          details?: string | null
          due_on?: string | null
          id?: string
          opportunity_id?: string | null
          origin?: string
          priority?: string
          queue_order?: number | null
          status?: string
          title: string
          waiting_for?: string | null
        }
        Update: {
          action_type?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          details?: string | null
          due_on?: string | null
          id?: string
          opportunity_id?: string | null
          origin?: string
          priority?: string
          queue_order?: number | null
          status?: string
          title?: string
          waiting_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          can_see_amounts: boolean
          created_at: string
          digest_channel: string
          digest_hour: number
          drafting_examples: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          role: string
        }
        Insert: {
          can_see_amounts?: boolean
          created_at?: string
          digest_channel?: string
          digest_hour?: number
          drafting_examples?: string | null
          email: string
          full_name: string
          id: string
          is_active?: boolean
          role: string
        }
        Update: {
          can_see_amounts?: boolean
          created_at?: string
          digest_channel?: string
          digest_hour?: number
          drafting_examples?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: string
        }
        Relationships: []
      }
      tributes: {
        Row: {
          acknowledgee_address: string | null
          acknowledgee_contact_id: string | null
          acknowledgee_name: string | null
          donation_id: string
          honoree_contact_id: string | null
          honoree_name: string
          id: string
          notified_at: string | null
          notify: boolean
          tribute_type: string
        }
        Insert: {
          acknowledgee_address?: string | null
          acknowledgee_contact_id?: string | null
          acknowledgee_name?: string | null
          donation_id: string
          honoree_contact_id?: string | null
          honoree_name: string
          id?: string
          notified_at?: string | null
          notify?: boolean
          tribute_type: string
        }
        Update: {
          acknowledgee_address?: string | null
          acknowledgee_contact_id?: string | null
          acknowledgee_name?: string | null
          donation_id?: string
          honoree_contact_id?: string | null
          honoree_name?: string
          id?: string
          notified_at?: string | null
          notify?: boolean
          tribute_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tributes_acknowledgee_contact_id_fkey"
            columns: ["acknowledgee_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tributes_acknowledgee_contact_id_fkey"
            columns: ["acknowledgee_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tributes_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: true
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tributes_donation_id_fkey"
            columns: ["donation_id"]
            isOneToOne: true
            referencedRelation: "donations_redacted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tributes_honoree_contact_id_fkey"
            columns: ["honoree_contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "tributes_honoree_contact_id_fkey"
            columns: ["honoree_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      contact_stats: {
        Row: {
          average_gift: number | null
          contact_id: string | null
          days_since_contact: number | null
          donor_status: string | null
          first_gift_amount: number | null
          first_gift_date: string | null
          flag: string | null
          gift_count: number | null
          giving_last_year: number | null
          giving_this_year: number | null
          household_gift_count: number | null
          household_id: string | null
          household_lifetime_giving: number | null
          is_lybunt: boolean | null
          is_sybunt: boolean | null
          kit_due_on: string | null
          largest_gift: number | null
          last_gift_amount: number | null
          last_gift_date: string | null
          last_meaningful_contact_at: string | null
          last_meaningful_contact_kind: string | null
          lifetime_giving: number | null
          next_action_due_on: string | null
          next_action_id: string | null
          next_action_title: string | null
          next_action_type: string | null
          open_task_count: number | null
          pledge_balance: number | null
          soft_giving_last_year: number | null
          soft_giving_this_year: number | null
          soft_lifetime_giving: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      donations_redacted: {
        Row: {
          appeal_id: string | null
          campaign_id: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          donated_on: string | null
          fund_id: string | null
          gift_aid_claim_id: string | null
          gift_aid_status: string | null
          id: string | null
          installment_id: string | null
          is_gasds: boolean | null
          notes: string | null
          payment_method: string | null
          pledge_id: string | null
          receipt_pref: string | null
          receipt_status: string | null
          recurring_agreement_id: string | null
          status: string | null
          thank_you_status: string | null
        }
        Insert: {
          appeal_id?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          donated_on?: string | null
          fund_id?: string | null
          gift_aid_claim_id?: string | null
          gift_aid_status?: string | null
          id?: string | null
          installment_id?: string | null
          is_gasds?: boolean | null
          notes?: string | null
          payment_method?: string | null
          pledge_id?: string | null
          receipt_pref?: string | null
          receipt_status?: string | null
          recurring_agreement_id?: string | null
          status?: string | null
          thank_you_status?: string | null
        }
        Update: {
          appeal_id?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          donated_on?: string | null
          fund_id?: string | null
          gift_aid_claim_id?: string | null
          gift_aid_status?: string | null
          id?: string | null
          installment_id?: string | null
          is_gasds?: boolean | null
          notes?: string | null
          payment_method?: string | null
          pledge_id?: string | null
          receipt_pref?: string | null
          receipt_status?: string | null
          recurring_agreement_id?: string | null
          status?: string | null
          thank_you_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "donations_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "appeals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "donations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_gift_aid_claim_id_fkey"
            columns: ["gift_aid_claim_id"]
            isOneToOne: false
            referencedRelation: "gift_aid_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "pledge_balances"
            referencedColumns: ["next_installment_id"]
          },
          {
            foreignKeyName: "donations_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "pledge_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_pledge_id_fkey"
            columns: ["pledge_id"]
            isOneToOne: false
            referencedRelation: "pledge_balances"
            referencedColumns: ["pledge_id"]
          },
          {
            foreignKeyName: "donations_pledge_id_fkey"
            columns: ["pledge_id"]
            isOneToOne: false
            referencedRelation: "pledges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donations_recurring_agreement_id_fkey"
            columns: ["recurring_agreement_id"]
            isOneToOne: false
            referencedRelation: "recurring_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      pledge_balances: {
        Row: {
          amount_gbp: number | null
          appeal_id: string | null
          balance: number | null
          campaign_id: string | null
          contact_id: string | null
          currency: string | null
          fund_id: string | null
          installment_count: number | null
          next_installment_amount: number | null
          next_installment_due_on: string | null
          next_installment_id: string | null
          overdue_amount: number | null
          overdue_installment_count: number | null
          paid_amount: number | null
          paid_installment_count: number | null
          payment_count: number | null
          pledge_id: string | null
          pledged_on: string | null
          status: string | null
          total_amount: number | null
          write_off_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pledges_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "appeals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contact_stats"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "pledges_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      crm_auto_tag_contacts: {
        Args: { p_rule: Json }
        Returns: {
          contact_id: string
        }[]
      }
      crm_can_see_amounts: { Args: never; Returns: boolean }
      crm_gift_aid_status: {
        Args: {
          p_contact: string
          p_current: string
          p_donated_on: string
          p_is_gasds: boolean
          p_status: string
        }
        Returns: string
      }
      crm_is_member: { Args: never; Returns: boolean }
      crm_recompute_pledge: { Args: { p_pledge: string }; Returns: undefined }
      crm_role: { Args: never; Returns: string }
      crm_rolling_ga_claim: { Args: never; Returns: string }
      crm_rule: { Args: { p_key: string }; Returns: Json }
      crm_sync_household_soft_credits: {
        Args: { p_donation: string }
        Returns: undefined
      }
      crm_tier_rank: { Args: { p_tier: string }; Returns: number }
      run_nightly: { Args: never; Returns: Json }
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
