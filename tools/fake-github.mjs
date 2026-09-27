// Simulated GitHub API for admin tests and the local admin preview (no network, no real repo).
// install() replaces global fetch for api.github.com; tokens: "good" (push access), "readonly".
import { readFileSync } from "node:fs";

const realProducts = readFileSync(new URL("../content/products.json", import.meta.url), "utf8");
const realColors = readFileSync(new URL("../content/colors.json", import.meta.url), "utf8");

let n = 0;
export { gh, resetGitHub };
const sha = () => "sha" + (++n);
const gh = { branches: {}, files: {}, commits: [] }; // files[branch][path] = { sha, text }
function resetGitHub() {
  n = 0;
  const main = sha();
  gh.branches = { main };
  gh.files = { main: { "content/products.json": { sha: sha(), text: realProducts }, "content/colors.json": { sha: sha(), text: realColors } } };
  gh.commits = [];
}
const b64 = (t) => Buffer.from(t, "utf8").toString("base64");
export function install() {
resetGitHub();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith("https://api.github.com/")) return realFetch(input, init);
  const reply = (obj, status = 200) => new Response(obj === null ? null : JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  const tok = (init.headers.Authorization || "").slice(7);
  if (tok !== "good" && tok !== "readonly") return reply({ message: "Bad credentials" }, 401);
  const path = url.replace("https://api.github.com", "");
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  if (path === "/user") return reply({ login: "owner" });
  const repo = "/repos/rtrtssn4cn-hue/laccistudio-web";
  if (path === repo) return reply({ permissions: { push: tok === "good" } });
  const p = path.slice(repo.length);
  let m;
  if ((m = p.match(/^\/git\/ref\/heads\/(\w+)$/))) return gh.branches[m[1]] ? reply({ object: { sha: gh.branches[m[1]] } }) : reply({ message: "Not Found" }, 404);
  if (p === "/git/refs" && method === "POST") { const name = body.ref.replace("refs/heads/", ""); gh.branches[name] = body.sha; gh.files[name] = structuredClone(gh.files.main); return reply({ ref: body.ref }, 201); }
  if ((m = p.match(/^\/git\/refs\/heads\/(\w+)$/)) && method === "PATCH") { gh.branches[m[1]] = body.sha; gh.files[m[1]] = structuredClone(gh.files.main); return reply({}); }
  if ((m = p.match(/^\/contents\/(.+)\?ref=(\w+)$/)) && method === "GET") { const f = (gh.files[m[2]] || {})[m[1]]; return f ? reply({ sha: f.sha, content: b64(f.text) }) : reply({ message: "Not Found" }, 404); }
  if ((m = p.match(/^\/contents\/(.+)$/)) && method === "PUT") {
    const f = gh.files[body.branch][m[1]];
    if (f.sha !== body.sha) return reply({ message: "sha mismatch" }, 409);
    const next = { sha: sha(), text: Buffer.from(body.content, "base64").toString("utf8") };
    gh.files[body.branch][m[1]] = next; gh.branches[body.branch] = sha();
    gh.commits.push({ branch: body.branch, message: body.message });
    return reply({ content: { sha: next.sha } }, 200);
  }
  if ((m = p.match(/^\/compare\/main\.\.\.draft$/))) { const c = gh.commits.filter((x) => x.branch === "draft"); return reply({ ahead_by: c.length, commits: c.map((x) => ({ commit: { message: x.message, author: { date: "2026-09-27T00:00:00Z" } } })) }); }
  if (p.startsWith("/commits?")) return reply(gh.commits.filter((x) => x.branch === "main").map((x) => ({ commit: { message: x.message, author: { date: "2026-09-27T00:00:00Z" } } })));
  if (p === "/merges" && method === "POST") { gh.files.main = structuredClone(gh.files.draft); gh.branches.main = sha(); gh.commits.filter((x) => x.branch === "draft").forEach((x) => (x.branch = "main")); gh.branches.draft = gh.branches.main; return reply({ sha: gh.branches.main }, 201); }
  return reply({ message: "unhandled " + method + " " + p }, 400);
};
}
