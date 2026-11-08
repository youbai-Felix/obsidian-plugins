// Obsidian CDP 助手：deno run -A cdp.ts eval <exprFile>   表达式须为 IIFE 返回值
//                    deno run -A cdp.ts shot <out.png>
const PORT = 9223;

async function mainPageWs(): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await res.json();
  const pages = targets.filter(
    (t) => t.type === 'page' && t.url.startsWith('app://obsidian.md'),
  );
  if (pages.length === 0) throw new Error('Obsidian page target not found');
  // 渲染器闪崩重载会留 app undefined 的僵尸 target：逐个试探，挑 typeof app 有值的
  for (const p of pages) {
    const ok = await tryEvalAlive(p.webSocketDebuggerUrl);
    if (ok) return p.webSocketDebuggerUrl;
  }
  throw new Error('no alive Obsidian page target (app undefined on all)');
}

async function tryEvalAlive(wsUrl: string): Promise<boolean> {
  try {
    const w = new WebSocket(wsUrl);
    await new Promise((r, j) => {
      w.onopen = r;
      w.onerror = () => j(new Error('ws error'));
      setTimeout(() => j(new Error('timeout')), 3000);
    });
    const alive = await new Promise((resolve) => {
      const id = 1;
      w.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string);
        if (m.id === id) resolve(m?.result?.result?.value === true);
      };
      w.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: 'typeof app !== "undefined" && !!app.vault', returnByValue: true } }));
      setTimeout(() => resolve(false), 3000);
    });
    w.close();
    return alive;
  } catch {
    return false;
  }
}

const ws = new WebSocket(await mainPageWs());
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = (e) => j(new Error('ws error'));
});
let idc = 0;
const pending = new Map<number, { res: unknown; rej: unknown }>();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data as string);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)!;
    pending.delete(m.id);
    m.error ? (rej as (e: Error) => void)(new Error(JSON.stringify(m.error))) : (res as (v: unknown) => void)(m.result);
  }
};
function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((res, rej) => {
    const id = ++idc;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const [mode, arg] = Deno.args;
if (mode === 'eval') {
  const expr = new TextDecoder().decode(await Deno.readFile(arg));
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails, null, 1));
    Deno.exit(1);
  }
  console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
} else if (mode === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await Deno.writeFile(arg, flexDecode(r.data));
  console.log('saved', arg);
} else if (mode === 'hovershot') {
  // hovershot <x> <y> <out.png>：把鼠标移到 (x,y) 触发 :hover，等动画完再截图
  const [hx, hy, outfile] = Deno.args.slice(1);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number(hx), y: Number(hy), button: 'none', pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 1500));
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await Deno.writeFile(outfile, flexDecode(r.data));
  console.log('saved', outfile);
} else if (mode === 'move') {
  // move <x> <y>：仅移动鼠标（触发/解除 hover）
  const [hx, hy] = Deno.args.slice(1);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number(hx), y: Number(hy), button: 'none', pointerType: 'mouse' });
  console.log('moved', hx, hy);
} else if (mode === 'click') {
  // click <x> <y>：可信级鼠标点击
  const [hx, hy] = Deno.args.slice(1);
  const x = Number(hx), y = Number(hy);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  console.log('clicked', hx, hy);
} else if (mode === 'clickribbon') {
  // clickribbon <x> <y>：先进入左缘 10px 悬停带等 ribbon 展开，再点目标（模拟真实用户轨迹）
  const [hx, hy] = Deno.args.slice(1);
  const x = Number(hx), y = Number(hy);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 6, y, button: 'none', pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 600));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 150));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 300));
  const chk = await send('Runtime.evaluate', { expression: `document.querySelector('.workspace-ribbon.mod-primary').matches(':hover')`, returnByValue: true });
  console.log('clicked', hx, hy, '| ribbon hover at click-time continuation:', chk.result.value);
} else {
  console.error('usage: cdp.ts eval <exprFile> | shot <out.png>');
  Deno.exit(1);
}
ws.close();

function flexDecode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
