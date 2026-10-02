import { AgentCard, type AgentSkill } from "@a2a-js/sdk";

/**
 * Skills this adapter advertises for the OpenHands we deploy.
 * Pi does not keep a copy of this list. It reads whatever card it is given.
 */
export const ADAPTER_SKILLS: AgentSkill[] = [
  {
    id: "run_command",
    name: "跑命令",
    description: "在那台电脑上执行命令。",
    tags: ["command"],
    examples: ["跑一下 uname"],
    inputModes: ["text/plain"],
    outputModes: ["text/plain"],
    securityRequirements: [],
  },
  {
    id: "edit_file",
    name: "改文件",
    description: "在那台电脑上改文件。用户要说改哪个文件、写成什么。",
    tags: ["file"],
    examples: ["把 README.md 改成一行：你好"],
    inputModes: ["text/plain"],
    outputModes: ["text/plain"],
    securityRequirements: [],
  },
  {
    id: "browse_on_computer",
    name: "这台电脑上的浏览器",
    description: "用那台电脑上的浏览器打开页面。",
    tags: ["browser"],
    examples: ["用那台电脑的浏览器打开这个页面"],
    inputModes: ["text/plain"],
    outputModes: ["text/plain"],
    securityRequirements: [],
  },
];

export function adapterCard(baseUrl: string): AgentCard {
  const card: AgentCard = {
    name: "OpenHands",
    description: "那台电脑上的 OpenHands。能力以这张卡的 skills 为准。",
    supportedInterfaces: [
      {
        url: baseUrl,
        protocolBinding: "HTTP+JSON",
        tenant: "",
        protocolVersion: "1.0",
      },
    ],
    provider: undefined,
    version: "adapter",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: ADAPTER_SKILLS,
    signatures: [],
  };
  return AgentCard.fromJSON(AgentCard.toJSON(card));
}
