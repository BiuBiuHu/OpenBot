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
import { connectionFailureText, type RemoteSkill } from "./remote-agent.js";
import type { SessionTools } from "./session-tools.js";
import type { OhConversation } from "./oh-client.js";
import type { LlmConfig } from "./types.js";

export const NO_MODEL_KEY_TEXT = "本地模型还没配密钥。";

export interface PiTurnResult {
  text: string;
  conversation?: OhConversation;
  /** Long remote body kept off the chat transcript. */
  kept?: string;
}

export interface PiSession {
  /** Receives the user's sentence unchanged. */
  prompt(text: string): Promise<PiTurnResult>;
  dispose(): void;
  toolNames(): string[];
  /** Skill ids taken from the agent card. Empty when there is no card. */
  skillKey: string;
}

export interface OpenBotPiOptions {
  llm?: LlmConfig;
  language?: string;
  cwd?: string;
  tools: SessionTools;
  /** Skills read from an agent card. Pi does not invent this list. */
  remoteSkills?: RemoteSkill[];
  /** Read the remote conversation captured during this prompt. */
  conversation?: () => OhConversation | undefined;
  /** Long remote text captured during this prompt. */
  kept?: () => string | undefined;
  /**
   * Replaces the provider stream. Tests use this to prove the original
   * sentence is what the model sees. Production leaves it unset.
   */
  modelStream?: (model: Model<any>, context: { messages: Array<{ role: string; content: unknown }> }) => AssistantMessageEventStream;
}

function systemPrompt(skills: RemoteSkill[]): string {
  const listed = skills.length
    ? skills.map((skill) => `- ${skill.id}：${skill.description}`).join("\n")
    : "（现在没有远端 agent card。不要假装已经把事情交给远端。）";
  return `你是 OpenBot。用简体中文，像人聊天。
基础问答自己回，一两句就停。不列步骤，不复述工具原文。对方没问的不展开。
你不是 OpenHands。有人问「你是谁」，就说你是 OpenBot。
时钟、读公开文档、网页查询是你自己的小工具。需要时再调用，不要在调用之前编造结果。
下面这些能力来自远端 agent card，不是写死在你这里的清单：
${listed}
对得上的，调用同名工具，把用户原话放进 goal。工具只把任务发出去。你不要自己跑命令、改文件，也不要自己打开那台电脑的浏览器。
工具如果回「连不上这台电脑。」，你就只回这一句。
远端做完后用一两句说结果。长结果已经留下，不要原样贴出。
不要说「这台电脑这轮没在时限里跑完。你再说一次就行。」`;
}

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
    systemPromptOverride: () => {
      const prompt = systemPrompt(options.remoteSkills || []);
      return language === "en" ? `${prompt}\nReply in English.` : prompt;
    },
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

  const customTools = piTools(options.tools, options.remoteSkills || []);
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    modelRuntime,
    thinkingLevel: "off",
    noTools: "builtin",
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
  });

  return {
    skillKey: (options.remoteSkills || []).map((skill) => skill.id).join(","),
    toolNames() {
      return customTools.map((tool) => tool.name);
    },
    async prompt(text: string) {
      await session.prompt(text);
      return {
        text: session.getLastAssistantText() || "",
        conversation: options.conversation?.(),
        kept: options.kept?.(),
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

function piTools(tools: SessionTools, skills: RemoteSkill[]): ToolDefinition[] {
  const local: ToolDefinition[] = [
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
  ];
  const remote = skills.map((skill) => ({
    name: skill.id,
    label: skill.name,
    description: `${skill.description} 这个工具不自己做，只把用户原话发给远端。`,
    promptSnippet: skill.description,
    parameters: Type.Object({
      goal: Type.String({ description: "用户原话" }),
    }),
    async execute(_id: string, params: unknown) {
      const goal = String((params as { goal?: string }).goal || "");
      const result = await tools.sendSkill(skill.id, goal);
      const text =
        result.transport === "a2a" && result.dispatched
          ? result.failed
            ? result.text
            : "做完了。"
          : result.text || connectionFailureText();
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  }));
  return [...local, ...remote];
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
