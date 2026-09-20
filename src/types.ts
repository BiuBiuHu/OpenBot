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

export interface OpenBotConfig {
  host: HostConfig;
  worker: WorkerConfig;
  llm: LlmConfig;
  controlPlane: ControlPlaneConfig;
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
