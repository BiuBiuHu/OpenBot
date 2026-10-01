export interface HostConfig {
  name: string;
  hostname: string;
  user: string;
  port: number;
  identityFile?: string;
}

export interface WorkerConfig {
  remotePort: number;
  localPort: number;
  workspace: string;
  persist: "systemd-user" | "tmux" | "nohup" | "unknown";
  token: string;
  remoteHome: string;
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ControlPlaneConfig {
  port: number;
}

/** Local tunnel client for v0 remote runtime = OpenHands Agent Server. */
export interface OpenHandsConfig {
  /** Default http://127.0.0.1:8000 — reach via `ssh -L 127.0.0.1:8000:127.0.0.1:8000 user@host`. */
  baseUrl: string;
  /** Sent as X-Session-API-Key. From OH_SESSION_API_KEY (or OPENHANDS_API_KEY). */
  sessionApiKey: string;
  /** OH LocalWorkspace.working_dir. Not a public path. */
  workspaceDir: string;
  /**
   * Optional remote-loop model. Only sent with a non-empty llmApiKey.
   * From OH_LLM_MODEL / OPENHANDS_LLM_MODEL — never OPENAI_MODEL.
   */
  llmModel: string;
  /** Optional remote-loop key (OH_LLM_API_KEY). Never commit. Never use OPENAI_API_KEY. */
  llmApiKey: string;
}

export interface OpenBotConfig {
  host: HostConfig;
  worker: WorkerConfig;
  llm: LlmConfig;
  controlPlane: ControlPlaneConfig;
  openhands: OpenHandsConfig;
}

export interface HandoffProposal {
  id: string;
  goal: string;
  reason: string;
  threadId: string;
  createdAt: number;
}

export interface JobRecord {
  id: string;
  command: string;
  cwd: string;
  timeout_sec: number;
  status: string;
  exit_code: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error?: string;
}

export interface HostInfo {
  hostname: string;
  user: string;
  cwd: string;
  workspace: string;
  worker_home: string;
  pid: number;
  uname: {
    sysname: string;
    nodename: string;
    release: string;
    version: string;
    machine: string;
    string: string;
  };
  loadavg: number[];
  python: string;
  persist_hint: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "token"; text: string }
  | { type: "thought"; text: string }
  | { type: "handoff_proposal"; id: string; goal: string; reason: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "approval"; id: string; command: string; reason: string }
  | { type: "job"; job: JobRecord }
  | { type: "output"; jobId: string; chunk: string }
  | { type: "tool_result"; name: string; result: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ApprovalRequest {
  id: string;
  command: string;
  reason: string;
}
