// Trusted provisioning CLI for the new Motive project only. Credentials never enter stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
const file = new URL("../../../.env.neon.local", import.meta.url);
const line = readFileSync(file, "utf8").split(/\r?\n/).find((s) => s.startsWith("DATABASE_URL_DIRECT="));
if (!line) throw new Error("New Motive connection is missing");
const direct = new URL(line.slice("DATABASE_URL_DIRECT=".length));
if (direct.hostname !== "ep-square-sunset-ba7ywt3i.c-8.eu-central-1.aws.neon.tech" || direct.pathname !== "/etkinwms") throw new Error("Unexpected database target; refusing provisioning");
direct.searchParams.delete("channel_binding");direct.searchParams.set("sslmode", "verify-full");
const owner = decodeURIComponent(direct.username);
if (!/^[a-z_][a-z0-9_]*$/.test(owner)) throw new Error("Unexpected owner role");
const secret = () => randomBytes(32).toString("hex");
const roles = {wms_app:secret(),wms_auth:secret(),wms_worker:secret()};
const db = postgres(direct.toString(), { max: 1, prepare: false });
try {
  const existing = await db`select rolname from pg_roles where rolname in ('wms_app','wms_auth','wms_worker')`;
  if (existing.length) throw new Error("Provisioning already started; refusing password changes");
  await db.begin(async (tx) => {
    for (const [name, password] of Object.entries(roles)) await tx.unsafe(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    await tx.unsafe("CREATE ROLE wms_ops NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION");
    await tx.unsafe("CREATE ROLE wms_identity_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION");
    await tx.unsafe(`GRANT wms_identity_probe TO ${owner} WITH ADMIN FALSE, SET TRUE, INHERIT FALSE`);
  });
  const uri = (/** @type {keyof typeof roles} */ name) => {const u = new URL(direct);u.username=name;u.password=roles[name];u.hostname=u.hostname.replace(".c-8.","-pooler.c-8.");return u.toString();};
  const env = ["WMS_ENV=production","DEMO_MODE=0","MAIL_MODE=disabled","DATABASE_URL="+uri("wms_app"),"AUTH_DATABASE_URL="+uri("wms_auth"),"DATABASE_URL_WORKER="+uri("wms_worker"),"BETTER_AUTH_URL=https://etkinwms.com","BETTER_AUTH_SECRET="+secret(),"QUEUE_SEAL_KEY="+secret()].join("\n")+"\n";
  writeFileSync(new URL("../../../.env.motive.local",import.meta.url),env,{mode:0o600});
  writeFileSync(file,"DATABASE_URL_DIRECT="+direct.toString()+"\n",{mode:0o600});
  console.log("Motive roles provisioned; isolated runtime credentials stored locally (not displayed).");
} catch (error) {
  // Never emit database error objects: they can contain SQL and password literals.
  console.error(error instanceof Error && error.message.startsWith("Provisioning already") ? error.message : "Motive provisioning failed; no credentials printed.");process.exitCode=1;
} finally { await db.end(); }
