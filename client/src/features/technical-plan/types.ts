import type { OutlineContentMode, OutlineData, OutlineExpansionMode, OutlineMode, OutlineWordControlOptions } from '../../shared/types';

export type TechnicalPlanStep = 'document-analysis' | 'bid-analysis' | 'outline-generation' | 'global-facts' | 'content-edit' | 'expand';
export type TechnicalPlanWorkflowKind = 'technical-plan' | 'existing-plan-expansion';
export type BidAnalysisMode = 'key' | 'full' | 'custom';
export type BidAnalysisTaskStatus = 'idle' | 'running' | 'success' | 'error';
export type BidSectionMode = 'single' | 'multiple';
export type BidSectionExtractionStatus = 'idle' | 'running' | 'success' | 'error';
export type BackgroundTaskType = 'bid-section-extraction' | 'bid-analysis' | 'outline-generation' | 'outline-adjustment' | 'global-facts-generation' | 'global-facts-adjustment' | 'content-generation';
export type BackgroundTaskStatus = 'running' | 'pausing' | 'paused' | 'success' | 'error';
export type ContentGenerationSectionStatus = 'idle' | 'running' | 'success' | 'error' | 'ignored';
export type ContentGenerationPhase = 'planning' | 'restoring' | 'generating' | 'section-word-adjusting' | 'original-auditing' | 'auditing' | 'table-cleaning' | 'final-section-word-adjusting' | 'total-word-adjusting' | 'illustration-planning' | 'illustration-generating' | 'done';
export type ContentTableRequirement = 'none' | 'light' | 'moderate' | 'heavy';
export type ConsistencyRepairMode = 'agent' | 'normal';
export type OriginalPlanCoverageRepairMode = 'agent' | 'normal';
export type SaveOutlineReason = 'sort' | 'edit' | 'delete' | 'add-root' | 'add-child' | 'replace';
export type OutlineAttribute = '通用' | '商务' | '资信' | '技术' | '其他';
export type GlobalFactsMode = 'fabricate' | 'omit' | 'placeholder';

export interface BidPlanSourceRef {
  source_id?: string;
  page?: string;
  section?: string;
  chunk_id?: string;
  label?: string;
}

export interface BidPlanTechnicalTopic {
  id: string;
  title: string;
  requirements: Array<{ text: string; source_refs: BidPlanSourceRef[] }>;
  source_refs: BidPlanSourceRef[];
  importance: 'critical' | 'high' | 'medium' | 'low';
  recommended_section: string;
  evidence_categories: string[];
  keywords: string[];
}

export interface BidPlanState {
  schema_version: number;
  project_type: { primary: 'equipment_procurement' | 'goods_procurement' | 'engineering' | 'service' | 'software_it' | 'mixed'; secondary: string[] };
  procurement_targets: Array<{ name: string; quantity: string; unit: string; category: string; source_refs: BidPlanSourceRef[] }>;
  project_characteristics: string[];
  technical_topics: BidPlanTechnicalTopic[];
  parameter_candidates?: Array<{ key: string; label: string; tender_requirement: string; bid_value: string; status: 'UNKNOWN'; source_refs: BidPlanSourceRef[] }>;
  service_topics: string[];
  required_tables: Array<{ type: 'technical_parameter_response' | 'technical_deviation' | 'supply_scope'; required: boolean; template_preferred: boolean; template_title: string; columns: string[]; source_refs: BidPlanSourceRef[]; reason: string }>;
  evaluation_topics: Array<{ topic: string; score: string; requirement: string; source_refs: BidPlanSourceRef[] }>;
  proposal_parts: string[];
  unknowns: string[];
}

export interface OutlineCoverageState {
  covered_topics: Array<{ topic_id: string; title: string; status: 'covered'; node_ids: string[]; score: number }>;
  partially_covered_topics: Array<{ topic_id: string; title: string; status: 'partial'; node_ids: string[]; score: number }>;
  missing_topics: Array<{ topic_id: string; title: string; status: 'missing'; node_ids: string[]; score: number }>;
  coverage_score: number;
  covered_count: number;
  total_count: number;
  /** 缺少技术主题时为 false，coverage_score 固定为 0：那是提取失败，不是覆盖完美。 */
  computable: boolean;
}

/** 招标文件自己规定的响应文件章节覆盖：合规骨架，与技术主题覆盖是两把尺子。 */
export interface ResponseSectionCoverageState {
  /** 未解析出章节清单时为 false，不应据此判合格或不合格。 */
  computable: boolean;
  reason?: string;
  required_total: number;
  optional_total: number;
  covered_count: number;
  coverage_score: number;
  missing_required: Array<{ name: string; category: string; category_label: string }>;
  thin_sections: Array<{
    name: string;
    category: string;
    category_label: string;
    node_id: string;
    node_title: string;
    content_mode: string;
    content_chars: number;
  }>;
  by_category: Record<string, { label: string; total: number; covered: number; missing: string[] }>;
}

export interface BidQualityCheckState {
  technical_coverage: OutlineCoverageState;
  response_section_coverage?: ResponseSectionCoverageState;
  parameter_conflicts: unknown[];
  duplicate_sections: unknown[];
  missing_tables: string[];
  unsupported_claims: unknown[];
}

export interface ParameterRegistryState {
  schema_version: number;
  unknown_placeholder: string;
  parameters: Array<{ key: string; label: string; tender_requirement: string; bid_value: string; status: 'CONFIRMED' | 'PARTIAL' | 'UNKNOWN'; source_type: string; source_refs: BidPlanSourceRef[]; confidence: number }>;
}

export interface SaveOutlineRequest {
  outlineData: OutlineData;
  reason: SaveOutlineReason;
  idMap?: Record<string, string>;
  affectedNodeIds?: string[];
}

export interface OutlineSelectionItem {
  id: string;
  title: string;
  description: string;
  attr: OutlineAttribute;
  content_mode: OutlineContentMode;
  content_mode_note?: string;
}

export interface OutlineSelectionState {
  items: OutlineSelectionItem[];
  selected_ids: string[];
  confirmed: boolean;
  auto_answer_at?: string;
}

export interface SaveOutlineSelectionRequest {
  taskId: string;
  items: OutlineSelectionItem[];
  selectedIds: string[];
}

export interface ContentGenerationOptions {
  useAiImages: boolean;
  maxAiImages: number;
  useMermaidImages: boolean;
  maxMermaidImages: number;
  useHtmlImages: boolean;
  maxHtmlImages: number;
  htmlImageTypes: string;
  tableRequirement: ContentTableRequirement;
  enableConsistencyAudit: boolean;
  consistencyRepairMode: ConsistencyRepairMode;
  enableOriginalPlanCoverageAudit: boolean;
  originalPlanCoverageRepairMode: OriginalPlanCoverageRepairMode;
}

export interface ContentGenerationProgressDetail {
  mode: 'full' | 'single' | 'correction' | 'illustration' | 'illustration-generation';
  phase: ContentGenerationPhase;
  phase_label: string;
  phase_progress: number;
  completed: number;
  total: number;
  step: string;
  step_label: string;
}

export interface BackgroundTaskState {
  task_id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  progress: number;
  progress_detail?: ContentGenerationProgressDetail;
  logs: string[];
  started_at: string;
  updated_at: string;
  error?: string;
  stats?: {
    agent?: {
      task_key: string;
      run_id: string;
      status: 'created' | 'running' | 'waiting-outline-selection' | 'success' | 'interrupted' | 'error';
      phase?: 'initial-outline' | 'outline-selection' | 'score-planning' | 'leaf_allocation' | 'children_generation' | 'leaf_adjustment' | 'leaf_final_decision' | 'outline_review_compaction' | 'outline_review' | 'completed' | string;
      agent_connection?: 'idle' | 'running';
      session_file?: string;
      resume_payload?: {
        reference_knowledge_document_ids?: string[];
        outline_mode?: OutlineMode;
        outline_expansion_mode?: OutlineExpansionMode;
        word_control_options?: OutlineWordControlOptions;
      };
    };
    outline_selection?: OutlineSelectionState;
    outline?: {
      phase: 'generating' | 'reviewing' | 'word-adjusting' | 'second-review' | 'done';
      current_leaf_count: number;
      target_leaf_count?: number | null;
      leaf_counts_by_mode?: Partial<Record<OutlineContentMode, number>>;
      minimum_leaf_count?: number;
      maximum_leaf_count?: number;
      word_adjustment_attempts: number;
      word_adjustment_warning?: string;
      word_adjustment_warning_kind?: 'leaf-count' | 'quality';
      technical_coverage?: OutlineCoverageState;
    };
    content?: {
      phase: ContentGenerationPhase;
      planning_total: number;
      planning_completed: number;
      restoration_total?: number;
      restoration_completed?: number;
      generation_total: number;
      generation_completed: number;
      minimum_words?: number;
      maximum_words?: number;
      section_words?: number;
      strict_section_words?: boolean;
      current_words?: number;
      section_adjustment_total?: number;
      section_adjustment_completed?: number;
      section_adjustment_active_count?: number;
      section_adjustment_item_id?: string;
      section_adjustment_round?: number;
      section_adjustment_round_total?: number;
      total_adjustment_round?: number;
      total_adjustment_round_total?: number;
      total_adjustment_mode?: 'expand' | 'shrink' | '';
      total_adjustment_batch_total?: number;
      total_adjustment_batch_completed?: number;
      total_adjustment_batch_failed?: number;
      total_adjustment_active_count?: number;
      total_adjustment_item_id?: string;
      total_adjustment_remaining_words?: number;
      word_control_warning?: string;
      audit_group_total?: number;
      audit_group_completed?: number;
      audit_step?: '' | 'checking' | 'fixing' | 'agent' | 'done';
      audit_conflict_total?: number;
      audit_fix_total?: number;
      audit_fix_completed?: number;
      audit_fix_failed?: number;
      audit_repair_mode?: ConsistencyRepairMode | '';
      audit_agent_step_total?: number;
      audit_agent_step_completed?: number;
      audit_agent_step_label?: string;
      audit_agent_changed_sections?: number;
      audit_agent_failed_sections?: number;
      table_cleanup_total?: number;
      table_cleanup_completed?: number;
      table_cleanup_rewritten?: number;
      table_cleanup_skipped?: number;
      illustration_planning_step_total?: number;
      illustration_planning_step_completed?: number;
      illustration_planning_step_label?: string;
      illustration_candidate_ai?: number;
      illustration_candidate_mermaid?: number;
      illustration_candidate_html?: number;
      illustration_selected_ai?: number;
      illustration_selected_mermaid?: number;
      illustration_selected_html?: number;
      illustration_generation_total?: number;
      illustration_generation_completed?: number;
      illustration_generation_ai_total?: number;
      illustration_generation_ai_completed?: number;
      illustration_generation_mermaid_total?: number;
      illustration_generation_mermaid_completed?: number;
      illustration_generation_html_total?: number;
      illustration_generation_html_completed?: number;
      illustration_generation_step_label?: string;
      awaiting_content_decision?: boolean;
      ignored_section_count?: number;
    };
  };
}

export interface BidAnalysisTaskState {
  id: string;
  label: string;
  status: BidAnalysisTaskStatus;
  content: string;
  error?: string;
}

export type BidAnalysisTasks = Record<string, BidAnalysisTaskState>;

export interface GlobalFactGroupState {
  id: string;
  title: string;
  content: string;
  updated_at?: string;
}

export interface ContentGenerationSectionState {
  id: string;
  title: string;
  status: ContentGenerationSectionStatus;
  content: string;
  error?: string;
  updated_at?: string;
}

export type ContentGenerationSections = Record<string, ContentGenerationSectionState>;

export type ContentMermaidDiagramType = 'process' | 'hierarchy' | 'responsibility';
export type ContentIllustrationKind = 'ai' | 'mermaid' | 'html' | 'asset';
export type ContentIllustrationPlacement = 'before' | 'after';

export interface ContentGenerationPlanData {
  writing_focus?: string;
  knowledge: {
    item_ids: string[];
  };
  facts: {
    titles: string[];
  };
  table: {
    needed: boolean;
    purpose: string;
  };
  original_material?: {
    restored: boolean;
    optimized: boolean;
    source_ids: string[];
    source_titles: string[];
    source_hashes: string[];
    restored_chars: number;
    restored_at?: string;
    optimized_at?: string;
  };
  section_brief?: Record<string, unknown>;
  evidence_pack?: Record<string, unknown>;
}

export interface ContentGenerationPlanState {
  plan_version: number;
  plan: ContentGenerationPlanData;
  table_requirement?: 'none' | 'light' | 'moderate' | 'heavy';
  updated_at?: string;
}

export type ContentGenerationPlans = Record<string, ContentGenerationPlanState>;

export interface ContentIllustrationPlanItem {
  item_id: string;
  kind: ContentIllustrationKind;
  image_type: string;
  title: string;
  section_ids: string[];
  placement: ContentIllustrationPlacement;
  priority: number;
  asset_id?: string;
  asset_url?: string;
  generation?: {
    status: 'pending' | 'running' | 'success' | 'error';
    mode?: 'normal' | 'agent';
    code?: string;
    source_path?: string;
    asset_url?: string;
    attempts?: number;
    error?: string;
    updated_at?: string;
  };
}

export interface ContentIllustrationPlanState {
  plan_version: number;
  revision: string;
  items: ContentIllustrationPlanItem[];
  updated_at?: string;
}

export interface ContentGenerationRuntimeState {
  phase?: string;
  touched_item_ids?: string[];
  completed_stages?: string[];
  word_adjustment_stage?: 'section' | 'final-section' | 'total';
  word_adjustment_item_id?: string;
  word_adjustment_round?: number;
  word_adjustment_item_rounds?: Record<string, number>;
  word_adjustment_completed_item_ids?: string[];
  word_adjustment_no_progress_rounds?: number;
  word_adjustment_round_start_words?: number;
  target_item_id?: string;
  regenerate_requirement?: string;
  awaiting_content_decision?: boolean;
  updated_at?: string;
}

export interface TechnicalPlanTenderFile {
  fileName: string;
  markdownPath: string;
  markdownChars: number;
  contentHash: string;
  originalMarkdownPath?: string;
  originalMarkdownChars?: number;
  originalContentHash?: string;
  parserLabel?: string;
  importedAt?: string;
  selectedSectionId?: string;
  selectedSectionTitle?: string;
  updatedAt: string;
}

export interface TechnicalPlanTenderSourceFile {
  id: string;
  fileName: string;
  markdownPath: string;
  markdownChars: number;
  contentHash: string;
  parserLabel?: string;
  sourceDocxPath?: string;
  importedAt?: string;
  updatedAt: string;
}

export interface TechnicalPlanOriginalPlanFile {
  fileName: string;
  markdownPath: string;
  markdownChars: number;
  contentHash: string;
  parserLabel?: string;
  importedAt?: string;
  updatedAt: string;
}

export interface BidSectionLineRange {
  startLine: number;
  endLine: number;
  reason?: string;
}

export interface DetectedBidSection {
  id: string;
  index: number;
  unit: string;
  title: string;
  headLine: string;
  description: string;
  includeRanges?: BidSectionLineRange[];
  evidence?: string[];
}

export interface TechnicalPlanState {
  workflowKind: TechnicalPlanWorkflowKind;
  step: TechnicalPlanStep;
  tenderFile: TechnicalPlanTenderFile | null;
  tenderFiles: TechnicalPlanTenderSourceFile[];
  originalPlanFile: TechnicalPlanOriginalPlanFile | null;
  projectOverview: string;
  techRequirements: string;
  bidAnalysisMode: BidAnalysisMode;
  bidAnalysisSelectedTaskIds: string[];
  bidAnalysisTasks: BidAnalysisTasks;
  bidAnalysisProgress: number;
  bidSectionMode: BidSectionMode;
  bidSections: DetectedBidSection[];
  bidSectionExtractionStatus: BidSectionExtractionStatus;
  bidSectionExtractionError?: string;
  outlineMode: OutlineMode;
  outlineExpansionMode: OutlineExpansionMode;
  outlineWordControlOptions: OutlineWordControlOptions;
  outlineWordControlSnapshot?: OutlineWordControlOptions;
  referenceKnowledgeDocumentIds: string[];
  referencePastBidTemplateId?: string;
  bidSectionExtractionTask?: BackgroundTaskState;
  bidAnalysisTask?: BackgroundTaskState;
  outlineGenerationTask?: BackgroundTaskState;
  outlineAdjustmentTask?: BackgroundTaskState;
  globalFactsMode: GlobalFactsMode;
  globalFactsTask?: BackgroundTaskState;
  globalFactsAdjustmentTask?: BackgroundTaskState;
  globalFacts: GlobalFactGroupState[];
  contentGenerationTask?: BackgroundTaskState;
  contentGenerationOptions?: ContentGenerationOptions;
  contentGenerationSections: ContentGenerationSections;
  contentGenerationPlans: ContentGenerationPlans;
  contentIllustrationPlan?: ContentIllustrationPlanState;
  contentGenerationRuntime?: ContentGenerationRuntimeState;
  bidTemplateExists?: boolean;
  bidPlan?: BidPlanState;
  responseTables?: Partial<Record<'technical_parameter_response' | 'technical_deviation' | 'supply_scope', Record<string, unknown>>>;
  parameterRegistry?: ParameterRegistryState;
  qualityCheck?: BidQualityCheckState;
  outlineData: OutlineData | null;
}
