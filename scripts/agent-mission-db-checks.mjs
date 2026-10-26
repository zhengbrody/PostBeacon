// Called only by the isolated PostgreSQL harness. No credentials, env files or network APIs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyAgentMissions({ sql, file }) {
  const checks = [];
  const last = (value) => value.split("\n").at(-1);
  const scalar = async (query) => last(await sql(query));
  const service = (query) => scalar(`set role service_role; ${query}`);
  const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const migration = "supabase/migrations/20261026_agent_missions.sql";
  const audit = async () => {
    const result = await file("supabase/audit-agent-missions.sql");
    assert.ok(
      !result.stdout.includes("FAIL") && result.stdout.match(/PASS/g)?.length === 10,
      "all ten mission installation checks must pass"
    );
  };
  await file(migration);
  await file(migration);
  await audit();
  checks.push("mission migration rerun and ten-row audit");
  await sql("update agent_daily_totals set reserved_runs=0;");
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID(),
    d = randomUUID();
  const pa = randomUUID(),
    pb = randomUUID(),
    pc = randomUUID(),
    pd = randomUUID();
  await sql(`insert into auth.users values('${a}'),('${b}'),('${c}'),('${d}');
    insert into projects(id,user_id) values('${pa}','${a}'),('${pb}','${b}'),('${pc}','${c}'),('${pd}','${d}');`);
  const settings = {
    brief: {
      mode: "product-led",
      audience: "Fictional developers",
      task: "Inspect a fictional sample",
      entryUrl: "https://example.org/demo",
      platformId: "twitter",
      venue: "Own profile",
      steps: ["Open sample", "Inspect job", "Describe unclear step"],
      feedbackQuestion: "Which step was unclear?",
      sources: [],
    },
    searchQueries: ["public job reliability"],
    allowedDomains: ["example.org"],
    enabled: true,
  };
  const payload = { provider: "openai", input: settings.brief };
  const save = (owner, project, revision = null, context = "fictional-context") =>
    service(
      `select save_agent_mission('${owner}','${project}','${context}',${json(settings)},${revision ?? "null"})->>'id';`
    );
  const reserve = (
    owner,
    mission,
    revision = 1,
    context = "fictional-context",
    body = payload
  ) =>
    service(
      `select reserve_agent_mission_run('${owner}','${mission}','${context}',${revision},${json(body)})->>'id';`
    );
  const stamps = new Map();
  const stamp = async (run) => {
    const value = await scalar(
      `select p.updated_at::text from projects p join agent_runs r on r.project_id=p.id where r.id='${run}';`
    );
    stamps.set(run, value);
    return value;
  };
  const claim = async (owner, run) => {
    const lease = await service(
      `select transition_agent_run('${owner}','${run}','claim')->>'lease_token';`
    );
    if (lease) await stamp(run);
    return lease;
  };
  const transition = (owner, run, action, lease, data = null) =>
    service(
      `select transition_agent_mission_run('${owner}','${run}','${action}','${lease}',${data === null ? "null" : json(data)},'${stamps.get(run)}'::timestamptz) is not null;`
    );
  const expireLease = (run) =>
    sql(
      `update agent_runs set lease_expires_at=now()-interval '1 second' where id='${run}';`
    );
  const ma = await save(a, pa),
    mb = await save(b, pb),
    mc = await save(c, pc),
    md = await save(d, pd);
  assert.equal(
    await scalar(`select mission_data_initialized from entitlements where user_id='${a}'`),
    "t"
  );
  assert.equal(
    await scalar(
      `select expires_at=authorized_at+interval '30 days' from agent_missions where id='${ma}'`
    ),
    "t"
  );
  checks.push("explicit authorization marker and bounded thirty-day expiry");
  await assert.rejects(save(a, pb), /project_not_found/);
  await assert.rejects(save(a, pa), /revision_conflict/);
  await assert.rejects(reserve(b, ma), /project_not_found/);
  await assert.rejects(reserve(a, ma, 1, "different-context"), /context_conflict/);
  await assert.rejects(
    reserve(a, ma, 1, "fictional-context", { ...payload, provider: "deepseek" }),
    /context_conflict/
  );
  await assert.rejects(
    reserve(a, ma, 1, "fictional-context", {
      ...payload,
      input: { ...settings.brief, task: "changed" },
    }),
    /context_conflict/
  );
  await assert.rejects(
    sql(`set role service_role; insert into agent_missions(user_id,project_id,context_key,settings,enabled)
    values('${a}','${pb}','fictional',${json(settings)},true);`),
    /foreign key constraint/
  );
  assert.equal(
    await scalar(
      `set role authenticated; set "request.jwt.claim.sub"='${b}'; select count(*) from agent_missions where user_id='${a}';`
    ),
    "0"
  );
  await assert.rejects(
    sql(`set role authenticated; update agent_missions set enabled=false;`),
    /permission denied/
  );
  await assert.rejects(
    sql(
      `set role authenticated; select save_agent_mission('${a}','${pa}','fictional',${json(settings)},1);`
    ),
    /permission denied/
  );
  checks.push("mission owner RLS composite FK server-only writes and RPCs");

  await sql(`update projects set updated_at='2020-01-01T00:00:00Z' where id='${pa}';`);
  const daily = await Promise.all(Array.from({ length: 12 }, () => reserve(a, ma)));
  assert.equal(new Set(daily).size, 1, "same UTC-day authorization must reserve one task");
  assert.equal(
    await scalar(`select reserved_runs from agent_daily_usage where user_id='${a}'`),
    "1"
  );
  assert.equal(
    await scalar(
      `select reserved_runs from agent_daily_totals where day=(now() at time zone 'UTC')::date`
    ),
    "1"
  );
  assert.equal(
    await scalar(
      `select updated_at='2020-01-01T00:00:00Z'::timestamptz from projects where id='${pa}'`
    ),
    "t"
  );
  checks.push(
    "concurrent daily idempotency shares budget without extending project retention"
  );
  const ra = daily[0],
    leaseA = await claim(a, ra);
  assert.ok(leaseA);
  assert.equal(
    await transition(a, ra, "model", leaseA),
    "f",
    "no model reservation before search authorization"
  );
  const searchReservations = await Promise.all(
    Array.from({ length: 6 }, () => transition(a, ra, "search", leaseA))
  );
  assert.equal(searchReservations.filter((value) => value === "t").length, 1);
  await expireLease(ra);
  assert.equal(
    await claim(a, ra),
    "",
    "ambiguous search must not obtain a replacement lease"
  );
  assert.equal(await transition(a, ra, "model", leaseA), "f");
  checks.push(
    "one search reservation no ambiguous-search resume and expired-lease fencing"
  );

  const rb = await reserve(b, mb),
    leaseB = await claim(b, rb);
  assert.equal(await transition(b, rb, "search", leaseB), "t");
  const modelReservations = await Promise.all(
    Array.from({ length: 6 }, () => transition(b, rb, "model", leaseB))
  );
  assert.equal(modelReservations.filter((value) => value === "t").length, 1);
  assert.equal(await transition(a, rb, "complete", leaseB, { search: {} }), "f");
  const searchReceipt = {
    status: "completed",
    queries: settings.searchQueries,
    domains: settings.allowedDomains,
    searchedAt: new Date().toISOString(),
    resultCount: 1,
    candidateCount: 1,
  };
  assert.equal(
    await transition(b, rb, "complete", leaseB, {
      search: searchReceipt,
      research: { id: "fictional-result" },
    }),
    "t"
  );
  assert.equal(await transition(b, rb, "complete", leaseB, { search: searchReceipt }), "f");
  checks.push("one model reservation owner-bound completion and no duplicate completion");

  const rc = await reserve(c, mc),
    leaseC = await claim(c, rc);
  assert.equal(await transition(c, rc, "search", leaseC), "t");
  await service(`select pause_agent_mission('${c}','${pc}');`);
  assert.equal(await scalar(`select status from agent_runs where id='${rc}'`), "cancelled");
  assert.equal(await transition(c, rc, "model", leaseC), "f");
  await assert.rejects(reserve(c, mc), /mission_paused/);
  checks.push("pause revokes running search before model spend");

  const rd = await reserve(d, md),
    leaseD = await claim(d, rd);
  const edits = await Promise.allSettled([save(d, pd, 1), save(d, pd, 1)]);
  assert.equal(edits.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(edits.filter((value) => value.status === "rejected").length, 1);
  assert.equal(await scalar(`select revision from agent_missions where id='${md}'`), "2");
  assert.equal(await transition(d, rd, "search", leaseD), "f");
  await assert.rejects(reserve(d, md, 1), /revision_conflict/);
  checks.push("concurrent authorization CAS and revision-update fencing");

  const rd2 = await reserve(d, md, 2),
    leaseD2 = await claim(d, rd2);
  await sql(
    `update agent_missions set authorized_at=now()-interval '31 days', expires_at=now()-interval '1 day' where id='${md}';`
  );
  assert.equal(await transition(d, rd2, "search", leaseD2), "f");
  await assert.rejects(reserve(d, md, 2), /mission_paused/);
  checks.push("expired authorization cannot reserve search or model work");

  const e = randomUUID(),
    pe = randomUUID();
  await sql(
    `insert into auth.users values('${e}'); insert into projects(id,user_id) values('${pe}','${e}');`
  );
  const me = await save(e, pe),
    re = await reserve(e, me),
    leaseE = await claim(e, re);
  const changeProjectVersion = () =>
    sql(`update projects set updated_at=updated_at+interval '1 second' where id='${pe}';`);
  await changeProjectVersion();
  assert.equal(
    await transition(e, re, "search", leaseE),
    "f",
    "project update between read and paid search checkpoint must reject the old stamp"
  );
  assert.equal(
    await scalar(`select search_attempted from agent_runs where id='${re}'`),
    "f"
  );
  // Omitting the new stamp must not use an old five-argument overload as a bypass.
  assert.equal(
    await service(
      `select transition_agent_mission_run('${e}','${re}','search','${leaseE}',null) is null;`
    ),
    "t"
  );
  await stamp(re);
  assert.equal(await transition(e, re, "search", leaseE), "t");
  await changeProjectVersion();
  assert.equal(
    await transition(e, re, "model", leaseE),
    "f",
    "project update between read and model checkpoint must not permit model spend"
  );
  assert.equal(
    await scalar(`select model_attempted from agent_runs where id='${re}'`),
    "f"
  );
  await stamp(re);
  assert.equal(await transition(e, re, "model", leaseE), "t");
  await changeProjectVersion();
  assert.equal(
    await transition(e, re, "complete", leaseE, { search: searchReceipt }),
    "f",
    "project update between read and completion must reject stale result persistence"
  );
  assert.equal(await scalar(`select status from agent_runs where id='${re}'`), "running");
  await stamp(re);
  assert.equal(await transition(e, re, "complete", leaseE, { search: searchReceipt }), "t");
  await sql(`delete from auth.users where id='${e}';`);
  checks.push(
    "atomic project-version fence before search model and completion plus no legacy overload bypass"
  );

  for (let index = 0; index < 3; index++) {
    const owner = randomUUID(),
      project = randomUUID();
    await sql(
      `insert into auth.users values('${owner}'); insert into projects(id,user_id) values('${project}','${owner}');`
    );
    const mission = await save(owner, project),
      run = await reserve(owner, mission),
      lease = await claim(owner, run);
    const version = stamps.get(run);
    // Hold the exact worker lock chain while deletion starts. Both operations
    // must finish, regardless of which owns the project lock first.
    await Promise.all([
      sql(
        `begin; set role service_role; select transition_agent_mission_run('${owner}','${run}','search','${lease}',null,'${version}'::timestamptz); select pg_sleep(0.15); commit;`
      ),
      service(`select delete_postbeacon_user_data('${owner}');`),
    ]);
    assert.equal(
      await scalar(`select count(*) from agent_runs where user_id='${owner}'`),
      "0"
    );
    assert.equal(
      await scalar(`select count(*) from agent_missions where user_id='${owner}'`),
      "0"
    );
    await sql(`delete from auth.users where id='${owner}';`);
  }
  checks.push(
    "concurrent account deletion and paid checkpoint share a non-deadlocking lock order"
  );

  await file("supabase/schema.sql");
  await file("supabase/migrations/20261025_agent_runs.sql");
  await file(migration);
  await audit();
  assert.equal(
    await scalar(`select mission_data_initialized from entitlements where user_id='${a}'`),
    "t"
  );
  checks.push("base schema and both Agent migrations can be safely reapplied");
  const globalBeforeDelete = await scalar(
    "select reserved_runs from agent_daily_totals where day=(now() at time zone 'UTC')::date"
  );
  await service(`select delete_postbeacon_user_data('${a}');`);
  assert.equal(
    await scalar(`select count(*) from agent_missions where user_id='${a}'`),
    "0"
  );
  assert.equal(await scalar(`select count(*) from agent_runs where user_id='${a}'`), "0");
  assert.equal(await scalar(`select count(*) from entitlements where user_id='${a}'`), "0");
  await sql(`delete from auth.users where id='${b}';`);
  assert.equal(
    await scalar(`select count(*) from agent_missions where user_id='${b}'`),
    "0"
  );
  assert.equal(await scalar(`select count(*) from agent_runs where user_id='${b}'`), "0");
  assert.equal(
    await scalar(
      "select reserved_runs from agent_daily_totals where day=(now() at time zone 'UTC')::date"
    ),
    globalBeforeDelete
  );
  await sql(`delete from projects where id='${pc}';`);
  assert.equal(
    await scalar(`select count(*) from agent_missions where user_id='${c}'`),
    "0"
  );
  assert.equal(await scalar(`select count(*) from agent_runs where user_id='${c}'`), "0");
  assert.equal(
    await scalar(`select reserved_runs from agent_daily_usage where user_id='${c}'`),
    "1"
  );
  await sql(`delete from auth.users where id in('${a}','${c}','${d}');`);
  checks.push(
    "account delete project cascade auth cascade and anonymous budget preservation"
  );
  return checks;
}
