/** Isolated, loopback-only browser acceptance fixture. No email or payment network calls. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.BROWSER_FIXTURE_DIR || '/tmp/openbot-browser-fixture';
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const receiptFile = path.join(root, 'receipt.json');
const shell = body => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OpenBot 操作验收 · 模拟环境</title><style>body{font:20px system-ui;max-width:850px;margin:60px auto;padding:24px;background:#f5f6fa;color:#202331}button,input{font:inherit;padding:12px;margin:12px}article{background:white;padding:24px;border-radius:14px}small{color:#656c7e}</style><h1>Personal Agent 操作验收</h1><p>隔离模拟环境，无真实邮件、商家或付款。</p>${body}</html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && url.pathname === '/receipt') {
    res.setHeader('Content-Type', 'application/json');
    res.end(fs.existsSync(receiptFile) ? fs.readFileSync(receiptFile) : 'null'); return;
  }
  if (req.method === 'POST' && url.pathname === '/order') {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) {res.writeHead(413);res.end();return;} }
    const data = new URLSearchParams(body);
    if (data.get('product') !== 'blue-notebook' || data.get('quantity') !== '2') {res.writeHead(400);res.end('选择或数量错误，请按邮件要求操作');return;}
    const receipt = { id:'DEMO-OPENBOT-001', product:'蓝色笔记本', quantity:2, status:'completed', simulated:true, charge:0, at:new Date().toISOString() };
    fs.writeFileSync(receiptFile, JSON.stringify(receipt), {mode:0o600});
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(shell(`<article><h2>测试订单已完成</h2><p>订单号：${receipt.id}</p><p>蓝色笔记本 × 2</p><p>模拟交易，实际收费 0 元。</p></article>`));return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if(url.pathname==='/shop') res.end(shell(`<article><h2>模拟商店</h2><form method="POST" action="/order"><p>请选择邮件中要求的商品。</p><label><input type="radio" name="product" value="red-notebook">红色笔记本</label><br><label><input type="radio" name="product" value="blue-notebook">蓝色笔记本</label><br><label>数量<input name="quantity" type="text" value="1" required></label><br><button type="submit">提交测试订单（不收费）</button></form></article>`));
  else res.end(shell(`<article><h2>模拟收件箱</h2><button id="mail" onclick="document.getElementById('message').hidden=false">打开邮件：下周会议物品</button><section id="message" hidden><h3>下周会议物品</h3><p>请到模拟商店准备两本蓝色笔记本，数量为 2。提交测试订单后，请告诉我订单编号和实际商品数量。</p><a href="/shop">前往模拟商店</a></section></article>`));
});
server.listen(Number(process.env.BROWSER_FIXTURE_PORT || 3861), '127.0.0.1', () => console.log('Browser fixture ready on loopback'));
