// Tipos compartilhados entre as Edge Functions.

export type SourceType =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "diario_oficial"
  | "website";

export type PipelineStep = "understand" | "rank" | "write" | "polish";

export type ContentStatus =
  | "captured"
  | "understanding"
  | "understood"
  | "ranking"
  | "ranked"
  | "discarded"
  | "writing"
  | "written"
  | "polishing"
  | "polished"
  | "ready"
  | "publishing"
  | "published"
  | "error";

export interface StepConfig {
  id: string;
  project_id: string | null;
  step: PipelineStep;
  provider: "gemini";
  model: string;
  system_prompt: string;
  user_prompt_template: string;
  temperature: number;
  max_output_tokens: number;
  extra: Record<string, unknown>;
  is_active: boolean;
}

export interface ContentItem {
  id: string;
  source_id: string;
  region_id: string;
  project_id: string;
  status: ContentStatus;
  external_id: string;
  external_url: string | null;
  title: string | null;
  raw_payload: Record<string, unknown>;
  transcript: string | null;
  understanding: Record<string, unknown> | null;
  rank_score: number | null;
  rank_rationale: Record<string, unknown> | null;
  draft: string | null;
  final_article: string | null;
  seo: Record<string, unknown> | null;
}

export interface Source {
  id: string;
  region_id: string;
  type: SourceType;
  name: string;
  url: string;
  is_active: boolean;
  check_interval_minutes: number;
  config: Record<string, unknown>;
  last_seen_marker: string | null;
  last_checked_at: string | null;
}
