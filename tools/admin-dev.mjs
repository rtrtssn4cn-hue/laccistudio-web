// Local preview of the new admin with a simulated GitHub (nothing leaves this computer).
//   node tools/admin-dev.mjs   → http://localhost:8788/admin/studio/  (in the browser console:
//   localStorage.setItem("decap-cms-user", JSON.stringify({token:"good"})) then reload)
import { createServer } from "node:http";
import worker from "../worker/index.js";
import { makeEnv } from "./worker-local.mjs";
import { install } from "./fake-github.mjs";

install();
const env = makeEnv({ ADMIN_GITHUB_REPO: "rtrtssn4cn-hue/laccistudio-web", STRIPE_SECRET_KEY: "" });
createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:8788${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const url = new URL(request.url);
  const response = url.pathname.startsWith("/api/") ? await worker.fetch(request, env) : await env.ASSETS.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8788, "127.0.0.1", () => console.log("Admin preview on http://localhost:8788/admin/studio/"));
