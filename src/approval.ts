export interface Classification {
  dangerous: boolean;
  reason: string;
}

const RULES: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/, reason: "recursive force delete (rm -rf)" },
  { re: /\bsudo\b/, reason: "elevated privileges (sudo)" },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/, reason: "host power action" },
  { re: /\bmkfs(\.\w+)?\b/, reason: "filesystem format (mkfs)" },
  { re: /\bdd\b.*\bof=\/dev\//, reason: "raw disk write (dd to /dev)" },
  { re: /\bof=\/dev\/(sd|nvme|vd|xvd|hd)/, reason: "write targeting a block device" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, reason: "fork bomb" },
  { re: /\b(curl|wget)\b[^|\n]*\|\s*(ba)?sh\b/, reason: "download piped to a shell" },
  { re: /\bchmod\s+-R\s+777\s+\//, reason: "world-writable recursive chmod on /" },
  { re: /\bkill\s+-9\s+1\b/, reason: "kill pid 1" },
  { re: /\biptables\s+-F\b/, reason: "flush firewall rules" },
  { re: /\b(userdel|passwd|visudo)\b/, reason: "account / sudoers change" },
  { re: /\bsystemctl\s+(stop|disable|mask)\s+ssh/, reason: "disable remote access" },
  { re: />\s*\/dev\/sd/, reason: "redirect onto a disk device" },
  { re: /\bmkfs\b|\bwipefs\b|\bparted\b/, reason: "destructive disk utility" },
];

export function classifyCommand(command: string): Classification {
  const text = command.trim();
  if (!text) {
    return { dangerous: false, reason: "" };
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return { dangerous: true, reason: rule.reason };
    }
  }
  return { dangerous: false, reason: "" };
}

export function needsApproval(command: string): boolean {
  return classifyCommand(command).dangerous;
}
