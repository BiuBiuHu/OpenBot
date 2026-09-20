import type { HostInfo, JobRecord } from "./types.js";

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

export class WorkerClient {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  static fromPort(port: number, token: string): WorkerClient {
    return new WorkerClient(`http://127.0.0.1:${port}`, token);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (auth) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new WorkerError(`worker returned non-JSON (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    if (!res.ok) {
      const err = data as { error?: string };
      throw new WorkerError(err.error || `worker HTTP ${res.status}`, res.status);
    }
    return data;
  }

  async health(): Promise<boolean> {
    try {
      const data = await this.request<{ ok?: boolean }>("GET", "/health", undefined, false);
      return data.ok === true;
    } catch {
      return false;
    }
  }

  async info(): Promise<HostInfo> {
    const data = await this.request<{ ok: boolean } & HostInfo>("GET", "/v1/info");
    return data;
  }

  async createJob(command: string, cwd?: string, timeoutSec?: number): Promise<JobRecord> {
    const data = await this.request<{ job: JobRecord }>("POST", "/v1/jobs", {
      command,
      cwd,
      timeout_sec: timeoutSec ?? 0,
    });
    return data.job;
  }

  async getJob(id: string): Promise<{ job: JobRecord; output: string; done: boolean; offset: number }> {
    return this.request("GET", `/v1/jobs/${id}`);
  }

  async listJobs(): Promise<JobRecord[]> {
    const data = await this.request<{ jobs: JobRecord[] }>("GET", "/v1/jobs");
    return data.jobs;
  }

  async pullLog(
    id: string,
    offset: number,
  ): Promise<{ job: JobRecord; chunk: string; offset: number; done: boolean }> {
    return this.request("GET", `/v1/jobs/${id}/log?offset=${offset}`);
  }

  async cancel(id: string): Promise<JobRecord | null> {
    const data = await this.request<{ job: JobRecord | null }>("POST", `/v1/jobs/${id}/cancel`, {});
    return data.job;
  }

  async readFile(path: string): Promise<{ ok: boolean; content?: string; error?: string; path?: string }> {
    return this.request("POST", "/v1/files/read", { path });
  }

  async writeFile(path: string, content: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    return this.request("POST", "/v1/files/write", { path, content });
  }

  async listDir(path: string): Promise<{
    ok: boolean;
    path?: string;
    entries?: Array<{ name: string; path: string; type: string; size: number | null }>;
    error?: string;
  }> {
    return this.request("POST", "/v1/files/list", { path });
  }

  async runAndCollect(
    command: string,
    opts: {
      cwd?: string;
      timeoutSec?: number;
      onChunk?: (chunk: string, job: JobRecord) => void;
      pollMs?: number;
    } = {},
  ): Promise<{ job: JobRecord; output: string }> {
    const job = await this.createJob(command, opts.cwd, opts.timeoutSec);
    let offset = 0;
    let output = "";
    for (;;) {
      const tick = await this.pullLog(job.id, offset);
      if (tick.chunk) {
        output += tick.chunk;
        opts.onChunk?.(tick.chunk, tick.job);
      }
      offset = tick.offset;
      if (tick.done) {
        return { job: tick.job, output };
      }
      await sleep(opts.pollMs ?? 120);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
