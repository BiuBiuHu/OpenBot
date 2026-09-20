import { classifyCommand } from "./approval.js";
import type { AgentEvent, ApprovalRequest, ChatMessage, LlmConfig, ToolCall } from "./types.js";
import type { WorkerClient } from "./worker-client.js";

const SYSTEM = `You are OpenBot, a remote-control agent for the user's own Linux machine.
The machine is theirs (VPS / mini PC / spare laptop), reached over SSH. You are not a hosted Firecracker PC and you do not have a desktop.
Tools execute on the remote host. Prefer small, reversible commands. Use run_shell for uname, processes, installs; use file tools for workspace files.
When the user asks what computer this is, run uname -a and report the remote result.
Never claim pixel computer-use or a cloud VM you do not have.`;

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Run a bash command on the user's remote Linux host. Output is collected from the persistent worker. Dangerous commands pause for user approval.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string", description: "Working directory on the remote host" },
          timeout_sec: { type: "integer", description: "0 means no timeout" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file on the remote host. Relative paths are under the OpenBot workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a text file on the remote host. Relative paths are under the OpenBot workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List a directory on the remote host.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

export interface AgentDeps {
  worker: WorkerClient;
  llm: LlmConfig;
  history?: ChatMessage[];
  emit: (event: AgentEvent) => void;
  waitForApproval: (req: ApprovalRequest) => Promise<boolean>;
  maxRounds?: number;
}

export async function runAgentTurn(userText: string, deps: AgentDeps): Promise<ChatMessage[]> {
  if (!deps.llm.apiKey) {
    deps.emit({
      type: "error",
      message: "No OPENAI_API_KEY. Set it in ~/.openbot/.env, or use `openbot run 'uname -a'` without a model.",
    });
    deps.emit({ type: "done" });
    return deps.history ?? [];
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...(deps.history ?? []),
    { role: "user", content: userText },
  ];

  const maxRounds = deps.maxRounds ?? 8;
  for (let round = 0; round < maxRounds; round++) {
    deps.emit({ type: "status", text: `model ${deps.llm.model} · round ${round + 1}` });
    const completion = await chatComplete(deps.llm, messages);
    const assistant = completion.choices?.[0]?.message;
    if (!assistant) {
      deps.emit({ type: "error", message: "Model returned an empty completion." });
      break;
    }
    const toolCalls = (assistant.tool_calls || []) as ToolCall[];
    const content = assistant.content || "";
    messages.push({
      role: "assistant",
      content,
      tool_calls: toolCalls.length ? toolCalls : undefined,
    });
    if (content) deps.emit({ type: "token", text: content });
    if (!toolCalls.length) break;

    for (const call of toolCalls) {
      const name = call.function?.name || "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      deps.emit({ type: "tool_start", name, args });
      const result = await executeTool(name, args, deps);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: result,
      });
      deps.emit({ type: "tool_result", name, result });
    }
  }
  deps.emit({ type: "done" });
  return messages.filter((m) => m.role !== "system");
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  deps: AgentDeps,
): Promise<string> {
  try {
    if (name === "run_shell") {
      const command = String(args.command || "").trim();
      if (!command) return "error: empty command";
      const verdict = classifyCommand(command);
      if (verdict.dangerous) {
        const id = `appr_${Date.now().toString(36)}`;
        deps.emit({ type: "approval", id, command, reason: verdict.reason });
        const allowed = await deps.waitForApproval({ id, command, reason: verdict.reason });
        if (!allowed) return `denied by user: ${verdict.reason}\ncommand: ${command}`;
      }
      const { job, output } = await deps.worker.runAndCollect(command, {
        cwd: args.cwd ? String(args.cwd) : undefined,
        timeoutSec: typeof args.timeout_sec === "number" ? args.timeout_sec : 120,
        onChunk: (chunk, current) => {
          deps.emit({ type: "job", job: current });
          deps.emit({ type: "output", jobId: current.id, chunk });
        },
      });
      deps.emit({ type: "job", job });
      return [
        `exit=${job.exit_code} status=${job.status} job=${job.id}`,
        output.trim() || "(no output)",
      ].join("\n");
    }
    if (name === "read_file") {
      const res = await deps.worker.readFile(String(args.path || ""));
      return res.ok ? `path=${res.path}\n${res.content}` : `error: ${res.error}`;
    }
    if (name === "write_file") {
      const res = await deps.worker.writeFile(String(args.path || ""), String(args.content || ""));
      return res.ok ? `wrote ${res.path}` : `error: ${res.error}`;
    }
    if (name === "list_dir") {
      const res = await deps.worker.listDir(String(args.path || "."));
      if (!res.ok) return `error: ${res.error}`;
      const lines = (res.entries || []).map((e) => `${e.type === "dir" ? "d" : "f"} ${e.name}`);
      return `${res.path}\n${lines.join("\n") || "(empty)"}`;
    }
    return `error: unknown tool ${name}`;
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface Completion {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
  error?: { message?: string };
}

async function chatComplete(llm: LlmConfig, messages: ChatMessage[]): Promise<Completion> {
  const url = `${llm.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${llm.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: llm.model,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });
  const data = (await res.json()) as Completion;
  if (!res.ok) {
    throw new Error(data.error?.message || `LLM HTTP ${res.status}`);
  }
  return data;
}
