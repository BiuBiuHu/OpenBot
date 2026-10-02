import type { AssistantMessageEventStream, Credential, CredentialStore, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { hasLocalModelKey } from "./config.js";
import { normalizeChatLanguage } from "./language.js";
import { textStream, userText } from "./pi-stream.js";
import type { SessionTools } from "./session-tools.js";
import type { OhConversation } from "./oh-client.js";
import type { LlmConfig } from "./types.js";

export const NO_MODEL_KEY_TEXT = "本地模型还没配密钥。";

export interface PiTurnResult {
  text: string;
  conversation?: OhConversation;
}

export interface PiSession {
  /** Receives the user's sentence unchanged. */
  prompt(text: string): Promise<PiTurnResult>;
  dispose(): void;
}

export interface OpenBotPiOptions {
  llm?: LlmConfig;
  language?: string;
  cwd?: string;
  tools: SessionTools;
  /** Read the remote conversation captured by ask_remote during this prompt. */
  conversation?: () => OhConversation | undefined;
  /**
   * Replaces the provider stream. Tests use this to prove the original
   * sentence is what the model sees. Production leaves it unset.
   */
  modelStream?: (model: Model<any>, context: { messages: Array<{ role: string; content: unknown }> }) => AssistantMessageEventStream;
}

const SYSTEM_PROMPT = `你是 OpenBot。用简体中文回答。你不是 OpenHands，不要做 OpenHands 的自我介绍。
有人问「你是谁」，就说你是 OpenBot，在用户自己的电脑上帮忙。
时钟、读公开文档、网页查询是你这个会话上的工具。先看用户原话，需要时再调用，不要在调用之前编造结果。
需要在用户那台电脑上执行命令或改文件时，调用 ask_remote_agent，把用户的原话交出去。那是另一个代理。
工具如果回「连不上这台电脑。」，你就只回这一句。
不要说「这台电脑这轮没在时限里跑完。你再说一次就行。」`;

export async function createOpenBotPiSession(options: OpenBotPiOptions): Promise<PiSession> {
  const cwd = options.cwd || path.join(os.tmpdir(), "openbot-pi-cwd");
  const agentDir = path.join(os.tmpdir(), "openbot-pi-agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  const language = normalizeChatLanguage(options.language);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => (language === "en" ? `${SYSTEM_PROMPT}\nReply in English.` : SYSTEM_PROMPT),
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const llm = options.llm;
  const modelId = (llm?.model || "openbot").trim() || "openbot";
  const baseUrl = (llm?.baseUrl || "http://127.0.0.1:9/v1").replace(/\/$/, "");
  const hasKey = hasLocalModelKey(llm?.apiKey);
  const model: Model<"openai-completions"> = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openbot",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };

  const credentials = memoryCredentials();
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const stream = options.modelStream ?? (hasKey ? undefined : noKeyStream);
  modelRuntime.registerProvider("openbot", {
    baseUrl,
    api: "openai-completions",
    apiKey: hasKey ? llm?.apiKey : "openbot-local",
    models: [
      {
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4_096,
      },
    ],
    ...(stream ? { streamSimple: stream as never } : {}),
  });
  if (hasKey && llm?.apiKey) await modelRuntime.setRuntimeApiKey("openbot", llm.apiKey);
  else await modelRuntime.setRuntimeApiKey("openbot", "openbot-local");

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    modelRuntime,
    thinkingLevel: "off",
    noTools: "builtin",
    customTools: piTools(options.tools),
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
  });

  return {
    async prompt(text: string) {
      await session.prompt(text);
      return {
        text: session.getLastAssistantText() || "",
        conversation: options.conversation?.(),
      };
    },
    dispose() {
      session.dispose();
    },
  };
}

function noKeyStream(
  _model: Model<any>,
  context: { messages: Array<{ role: string; content: unknown }> },
): AssistantMessageEventStream {
  const last = [...context.messages].reverse().find((message) => message.role === "user");
  // The user sentence is already in the Pi context. Do not answer it with a rule.
  void userText(last?.content);
  const zh = true;
  return textStream(zh ? NO_MODEL_KEY_TEXT : "No local model key.");
}

function piTools(tools: SessionTools): ToolDefinition[] {
  return [
    {
      name: "clock",
      label: "时钟",
      description: "读取上海时区的当前时间。用户问现在几点、今天的时间时调用。",
      promptSnippet: "时钟：上海当前时间",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: tools.clock() }], details: {} };
      },
    },
    {
      name: "read_public_document",
      label: "公开文档",
      description: "读取用户给出的公开 http(s) 文档，并返回简短中文。",
      promptSnippet: "读公开文档",
      parameters: Type.Object({
        request: Type.String({ description: "用户原话，或其中的公开文档 URL" }),
      }),
      async execute(_id, params) {
        const request = String((params as { request?: string }).request || "");
        const text = await tools.readPublicDocument(request);
        return { content: [{ type: "text", text }], details: {} };
      },
    },
    {
      name: "web_search",
      label: "网页查询",
      description: "查询公开网页。用户问某个公开产品或事实是什么时调用。",
      promptSnippet: "网页查询",
      parameters: Type.Object({
        query: Type.String({ description: "检索词" }),
      }),
      async execute(_id, params) {
        const query = String((params as { query?: string }).query || "");
        const text = await tools.webSearch(query);
        return { content: [{ type: "text", text }], details: {} };
      },
    },
    {
      name: "ask_remote_agent",
      label: "远程代理",
      description: "把需要用户那台电脑完成的任务交给远程 OpenHands 代理。传入用户原话。",
      promptSnippet: "远程电脑代理",
      parameters: Type.Object({
        goal: Type.String({ description: "交给远程代理的用户原话" }),
      }),
      async execute(_id, params) {
        const goal = String((params as { goal?: string }).goal || "");
        const text = await tools.askRemote(goal);
        return { content: [{ type: "text", text }], details: {} };
      },
    },
  ];
}

function memoryCredentials(): CredentialStore {
  const creds = new Map<string, Credential>();
  return {
    async read(id) {
      return creds.get(id);
    },
    async list() {
      return [...creds.keys()].map((providerId) => ({ providerId, type: "api_key" as const }));
    },
    async modify(id, fn) {
      const next = await fn(creds.get(id));
      if (next) creds.set(id, next);
      else creds.delete(id);
      return next;
    },
    async delete(id) {
      creds.delete(id);
    },
  };
}
