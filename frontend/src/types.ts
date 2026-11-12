export type Role = "technician" | "supervisor" | "administrator";
export interface User {
  username: string;
  name: string;
  role: Role;
  initials: string;
}
export interface Rule {
  field: string;
  op:
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "empty"
    | "not_empty";
  value?: string | number | boolean | null;
  message?: string;
}
export interface Field {
  id: string;
  label: string;
  type:
    "number" | "text" | "choice" | "checkbox" | "date" | "datetime" | "email";
  required: boolean;
  section: string;
  unit?: string;
  max?: number | null;
  options?: string[];
  default?: string | number | boolean | null;
  help?: string;
  formula?: string;
  option_list?: string;
  width?: 1 | 2;
  edit_roles?: Role[];
  invalid_if?: Rule[];
  flag_if?: Rule[];
  visible_if?: Rule[];
}
export interface Transition {
  id: string;
  label: string;
  source: string;
  target: string;
  roles: Role[];
  require_note: boolean;
  guards?: Rule[];
  guard_formula?: string;
  effects?: WorkflowEffect[];
  event?: "manual" | "completion" | "timer";
  after_seconds?: number;
  use_history?: boolean;
  prompt?: string;
  validate_required?: boolean;
  require_evidence?: boolean;
  require_no_tasks?: boolean;
  create_exception_task?: boolean;
}
export type Scalar = string | number | boolean | null;
export type FormValues = Record<string, Scalar | FormValues[]>;
export interface RepeatingTable {
  id: string;
  label: string;
  min_rows: number;
  max_rows: number;
  columns: Field[];
}
export interface Definition {
  tables?: RepeatingTable[];
  option_lists?: Record<string, { extends?: string; values: string[] }>;
  themes?: Record<string, { extends?: string; style: SheetCell["style"] & {} }>;
  theme?: string;
  theme_style?: SheetCell["style"];
  name: string;
  description: string;
  fields: Field[];
  evidence_on_exception: boolean;
  states: string[];
  transitions: Transition[];
  sheet?: Sheet;
  state_tree?: WorkflowNode[];
  state_settings?: Record<
    string,
    { editable?: boolean; x?: number; y?: number }
  >;
}
export interface Config {
  id: number;
  definition: Definition;
  published_by: string;
  created_at: string;
}
export interface Building {
  id: string;
  name: string;
  kind: string;
  floors: number;
}
export interface Asset {
  id: string;
  building_id: string;
  building_name: string;
  name: string;
  location: string;
  kind: string;
}
export interface RecordRow {
  id: number;
  title: string;
  asset_id: string;
  asset_name: string;
  building_id: string;
  building_name: string;
  category: string;
  priority: string;
  state: string;
  config_id: number;
  values_json: FormValues;
  owner_name: string;
  revision: number;
  created_at: string;
  updated_at: string;
  open_tasks: number;
}
export interface Audit {
  id: number;
  record_id: number | null;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}
export interface Task {
  id: number;
  record_id: number;
  title: string;
  status: string;
  assignee: string;
  due_at: string;
  escalated: boolean;
  record_title: string;
  building_id: string;
}
export interface Evidence {
  id: string;
  filename: string;
  media_type: string;
  size: number;
  sha256: string;
}
export interface Detail extends RecordRow {
  timers?: {
    id: number;
    transition_id: string;
    source: string;
    status: string;
    due_at: string;
    last_error?: string;
  }[];
  active_states?: string[];
  editable?: boolean;
  available_transitions?: string[];
  definition: Definition;
  exceptions: string[];
  evidence: Evidence[];
  audit: Audit[];
  tasks: Task[];
}
export interface Job {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}
export interface Handover {
  id: number;
  shift: string;
  note: string;
  snapshot: {
    records: RecordRow[];
    tasks: Task[];
    logbook?: {
      id: number;
      message: string;
      status: string;
      priority: string;
      event_time: string;
    }[];
  };
  author: string;
  acknowledged_by: string | null;
  created_at: string;
  acknowledged_at: string | null;
}
export interface Bootstrap {
  release_policy?: { review_required: boolean };
  user: User;
  buildings: Building[];
  assets: Asset[];
  records: RecordRow[];
  tasks: Task[];
  config: Config;
  versions: {
    id: number;
    published_by: string;
    created_at: string;
    name: string;
  }[];
  jobs: Job[];
  audit: Audit[];
  handovers: Handover[];
  worker: { last_seen: string; healthy: boolean } | null;
}

export interface SheetCell {
  value?: string | number | boolean | null;
  formula?: string;
  field?: string;
  style?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    align?: "left" | "center" | "right";
    background?: string;
    color?: string;
    font_size?: number;
    border?: boolean;
  };
}
export interface Sheet {
  rows: number;
  cols: number;
  cells: Record<string, SheetCell>;
  merges: { start: string; end: string }[];
  col_widths?: Record<string, number>;
  row_heights?: Record<string, number>;
  freeze_row?: boolean;
  freeze_column?: boolean;
}
export interface WorkflowEffect {
  field: string;
  formula: string;
}
export interface WorkflowNode {
  history?: "none" | "shallow" | "deep";
  id: string;
  label: string;
  kind: "atomic" | "compound" | "parallel" | "final";
  children?: WorkflowNode[];
  initial?: string;
  entry_effects?: WorkflowEffect[];
  exit_effects?: WorkflowEffect[];
}
