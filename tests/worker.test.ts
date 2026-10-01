import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startWorker } from "./helpers.js";

describe("REQ-OPENBOT-003 remote worker", () => {
  let ctx: Awaited<ReturnType<typeof startWorker>>;

  before(async () => {
    ctx = await startWorker();
  });

  after(() => {
    ctx?.stop();
  });

  it("TC-REMOTE-001: uname -a runs on the worker host", async () => {
    const { job, output } = await ctx.client.runAndCollect("uname -a", { timeoutSec: 15 });
    assert.equal(job.status, "succeeded");
    assert.equal(job.exit_code, 0);
    assert.match(output, /Linux/);
    const info = await ctx.client.info();
    assert.ok(info.uname.string.includes("Linux"));
    assert.ok(output.includes(info.uname.release) || output.includes(info.hostname));
  });

  it("TC-PERSIST-001: job records survive a client disconnect", async () => {
    const created = await ctx.client.createJob("sleep 0.4 && echo persist-ok");
    // Pretend the laptop closed: we stop polling, worker keeps the process.
    await new Promise((r) => setTimeout(r, 700));
    const again = await ctx.client.getJob(created.id);
    assert.equal(again.done, true);
    assert.match(again.output, /persist-ok/);
    const listed = await ctx.client.listJobs();
    assert.ok(listed.some((j) => j.id === created.id));
  });
});
