// Isolated local PostgreSQL only. Never accepts a production URL or reads .env.
import { execFile as callbackExecFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifyAgentMissions } from "./agent-mission-db-checks.mjs";

const execFile = promisify(callbackExecFile);
const root = await mkdtemp(join(tmpdir(), "postbeacon-agent-db-"));
const data = join(root, "data");
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: "C",
  PGCONNECT_TIMEOUT: "5",
};
const run = (bin, args) => execFile(bin, args, { env, maxBuffer: 1024 * 1024 });
const sql = async (query) =>
  (
    await run("psql", [
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      root,
      "-p",
      "55439",
      "-U",
      userInfo().username,
      "-d",
      "postgres",
      "-At",
      "-c",
      query,
    ])
  ).stdout.trim();
const file = (path) =>
  run("psql", [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-h",
    root,
    "-p",
    "55439",
    "-U",
    userInfo().username,
    "-d",
    "postgres",
    "-f",
    path,
  ]);
let started = false;
try {
  await run("initdb", ["-D", data, "--no-locale", "-A", "trust"]);
  await run("pg_ctl", [
    "-D",
    data,
    "-l",
    join(root, "server.log"),
    "-o",
    `-k ${root} -p 55439 -h ''`,
    "-w",
    "start",
  ]);
  started = true;
  await sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  await file("supabase/schema.sql");
  await file("supabase/migrations/20261025_agent_runs.sql");
  await file("supabase/migrations/20261025_agent_runs.sql"); // rerun safety
  await sql("grant all on all tables in schema public to service_role;");
  const audit = await file("supabase/audit-agent-runs.sql");
  assert.ok(
    !audit.stdout.includes("FAIL") && audit.stdout.match(/PASS/g)?.length === 8,
    "all installation audit rows must pass"
  );
  const a = randomUUID(),
    b = randomUUID(),
    pa = randomUUID(),
    pb = randomUUID(),
    request = randomUUID();
  await sql(`insert into auth.users values('${a}'),('${b}');
    insert into projects(id,user_id) values('${pa}','${a}'),('${pb}','${b}');
    insert into entitlements(user_id,plan,launches_used) values('${a}','pro',7);`);
  const reserve = (owner, project, key = randomUUID()) =>
    sql(`set role service_role;
    select public.reserve_agent_run('${owner}','${project}','${key}','openai','{}')->>'id';`);
  const values = await Promise.all(
    Array.from({ length: 12 }, () => reserve(a, pa, request))
  );
  assert.equal(
    new Set(values).size,
    1,
    "concurrent duplicate reservations must return one run"
  );
  assert.equal(
    await sql(`select reserved_runs from agent_daily_usage where user_id='${a}'`),
    "1"
  );
  assert.equal(
    await sql(`select agent_data_initialized from entitlements where user_id='${a}'`),
    "t"
  );
  assert.equal(
    await sql(`select plan||':'||launches_used from entitlements where user_id='${a}'`),
    "pro:7",
    "Agent reservation must not change billing entitlements"
  );
  const id = values[0].split("\n").at(-1);
  await assert.rejects(reserve(a, pb), /project_not_found/);
  await assert.rejects(
    sql(`set role service_role; insert into agent_runs(user_id,project_id,request_id,provider,payload)
    values('${a}','${pb}',gen_random_uuid(),'openai','{}');`),
    /foreign key constraint/
  );
  await assert.rejects(
    sql(
      `set role service_role; select reserve_agent_run('${a}','${pa}','${request}','deepseek','{}');`
    ),
    /request_conflict/
  );
  const claims = await Promise.all(
    Array.from({ length: 6 }, () =>
      sql(
        `set role service_role; select transition_agent_run('${a}','${id}','claim')->>'lease_token';`
      )
    )
  );
  const leases = claims.map((x) => x.split("\n").at(-1)).filter(Boolean);
  assert.equal(leases.length, 1, "only one worker may claim a task");
  const lease = leases[0];
  assert.equal(
    (
      await sql(
        `set role service_role; select transition_agent_run('${b}','${id}','cancel') is null;`
      )
    )
      .split("\n")
      .at(-1),
    "t"
  );
  const model = await Promise.all(
    Array.from({ length: 4 }, () =>
      sql(
        `set role service_role; select transition_agent_run('${a}','${id}','model','${lease}') is not null;`
      )
    )
  );
  assert.equal(
    model.filter((x) => x.endsWith("t")).length,
    1,
    "model request reservation must be at most once"
  );
  await sql(
    `update agent_runs set lease_expires_at=now()-interval '1 second' where id='${id}';`
  );
  assert.equal(
    (
      await sql(
        `set role service_role; select transition_agent_run('${a}','${id}','claim') is null;`
      )
    )
      .split("\n")
      .at(-1),
    "t",
    "ambiguous paid work must not resume"
  );
  const pre = await reserve(b, pb);
  const oldLease = await sql(
    `set role service_role; select transition_agent_run('${b}','${pre}','claim')->>'lease_token';`
  );
  await sql(
    `update agent_runs set lease_expires_at=now()-interval '1 second' where id='${pre}';`
  );
  const newLease = await sql(
    `set role service_role; select transition_agent_run('${b}','${pre}','claim')->>'lease_token';`
  );
  assert.notEqual(newLease, oldLease, "safe pre-model resume needs a new fence");
  assert.equal(
    await sql(
      `set role service_role; select transition_agent_run('${b}','${pre}','complete','${oldLease}','{}') is null;`
    ),
    "t"
  );
  await sql(
    `update agent_runs set lease_expires_at=now()-interval '1 second' where id='${pre}';`
  );
  assert.equal(
    await sql(
      `set role service_role; select transition_agent_run('${b}','${pre}','claim') is null;`
    ),
    "t",
    "pre-model resume is bounded"
  );
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => reserve(a, pa))
  );
  assert.equal(
    results.filter((x) => x.status === "fulfilled").length,
    9,
    "atomic user allowance must stop at ten total"
  );
  assert.equal(
    await sql(`select reserved_runs from agent_daily_usage where user_id='${a}'`),
    "10"
  );
  await sql("update agent_daily_totals set reserved_runs=99;");
  const global = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(b, pb)));
  assert.equal(
    global.filter((x) => x.status === "fulfilled").length,
    1,
    "global allowance must stop atomically at 100"
  );
  assert.equal(await sql("select reserved_runs from agent_daily_totals"), "100");
  assert.equal(
    (
      await sql(
        `set role authenticated; set "request.jwt.claim.sub"='${b}'; select count(*) from agent_runs where user_id='${a}';`
      )
    )
      .split("\n")
      .at(-1),
    "0",
    "RLS must hide another owner's tasks"
  );
  await assert.rejects(
    sql(`set role authenticated; select transition_agent_run('${a}','${id}','cancel');`),
    /permission denied/
  );
  await assert.rejects(
    sql(`set role authenticated; update agent_runs set status='ready';`),
    /permission denied/
  );
  await sql(`set role service_role; select transition_agent_run('${a}','${id}','cancel');`);
  assert.equal(
    (
      await sql(
        `set role service_role; select transition_agent_run('${a}','${id}','complete','${lease}','{}') is null;`
      )
    )
      .split("\n")
      .at(-1),
    "t",
    "cancel fences late completion"
  );
  await sql(`delete from projects where id='${pa}';`);
  assert.equal(await sql(`select count(*) from agent_runs where user_id='${a}'`), "0");
  assert.equal(
    await sql(`select reserved_runs from agent_daily_usage where user_id='${a}'`),
    "10",
    "project deletion must not reset quota"
  );
  await sql(`select delete_postbeacon_user_data('${a}');`);
  assert.equal(
    await sql(`select count(*) from agent_daily_usage where user_id='${a}'`),
    "0"
  );
  await sql(`delete from auth.users where id='${b}';`);
  assert.equal(
    await sql(`select count(*) from agent_runs where user_id='${b}'`),
    "0",
    "auth removal cascades task content"
  );
  assert.equal(
    await sql(`select count(*) from agent_daily_usage where user_id='${b}'`),
    "0",
    "auth removal cascades owner usage"
  );
  assert.equal(
    await sql("select reserved_runs from agent_daily_totals"),
    "100",
    "global counts cannot be reset by account deletion"
  );
  const missionChecks = await verifyAgentMissions({ sql, file });
  console.log(
    JSON.stringify(
      {
        localPostgres: true,
        productionTouched: false,
        checks: [
          "migration rerun",
          "concurrent idempotency",
          "owner/project binding",
          "composite FK",
          "one worker",
          "one model reservation",
          "no ambiguous retry",
          "bounded pre-model resume",
          "old lease fencing",
          "atomic user quota",
          "atomic global quota",
          "owner RLS",
          "server-only transitions",
          "cancel fencing",
          "project cascade",
          "quota survives project deletion",
          "account cleanup",
          "auth-user cascades",
          "anonymous global counts survive deletion",
          ...missionChecks,
        ],
      },
      null,
      2
    )
  );
} finally {
  if (started)
    await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
