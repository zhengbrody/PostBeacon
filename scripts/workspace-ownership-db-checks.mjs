// Disposable socket-only PostgreSQL harness only. No .env, production URL or network API.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyWorkspaceOwnership({ sql, file }) {
  const checks = [];
  const scalar = async (query) => (await sql(query)).split("\n").at(-1);
  const migration = "supabase/migrations/20261026_workspace_ownership.sql";
  const audit = async () => {
    const result = await file("supabase/audit-workspace-ownership.sql");
    assert.ok(
      !result.stdout.includes("FAIL") && result.stdout.match(/PASS/g)?.length === 7,
      "all seven workspace ownership checks must pass"
    );
    const base = await file("supabase/audit.sql");
    assert.ok(
      !base.stdout.includes("FAIL") && base.stdout.match(/PASS/g)?.length === 9,
      "additive composite references must not inflate original cascade counts"
    );
  };
  await file(migration);
  await file(migration);
  await audit();
  checks.push("workspace ownership migration rerun and seven-row audit plus base audit");

  const a = randomUUID(),
    b = randomUUID();
  const pa = randomUUID(),
    pb = randomUUID(),
    unusedB = randomUUID();
  const ca = randomUUID(),
    cb = randomUUID(),
    ea = randomUUID(),
    eb = randomUUID();
  const oa = randomUUID(),
    ob = randomUUID();
  const bad = randomUUID();
  await sql(`insert into auth.users values('${a}'),('${b}');
    insert into projects(id,user_id) values('${pa}','${a}'),('${pb}','${b}'),('${unusedB}','${b}');
    grant select,insert,update,delete on projects,campaigns,experiments,outcomes,tasks to authenticated;`);
  const asOwner = (owner, query) =>
    sql(`set role authenticated; set "request.jwt.claim.sub"='${owner}'; ${query}`);
  await asOwner(
    a,
    `insert into campaigns(id,user_id,project_id) values('${ca}','${a}','${pa}');
    insert into experiments(id,user_id,campaign_id,platform_id,published_at) values('${ea}','${a}','${ca}','twitter',now());
    insert into outcomes(id,user_id,experiment_id,checkpoint) values('${oa}','${a}','${ea}','24h');
    insert into tasks(campaign_id,id,user_id,kind,status) values('${ca}','valid-a','${a}','publish','done');`
  );
  await asOwner(
    b,
    `insert into campaigns(id,user_id,project_id) values('${cb}','${b}','${pb}');
    insert into experiments(id,user_id,campaign_id,platform_id,published_at) values('${eb}','${b}','${cb}','twitter',now());
    insert into outcomes(id,user_id,experiment_id,checkpoint) values('${ob}','${b}','${eb}','24h');
    insert into tasks(campaign_id,id,user_id,kind,status) values('${cb}','valid-b','${b}','publish','done');`
  );
  checks.push(
    "same-owner authenticated workspace inserts remain valid across all four links"
  );

  const links = [
    {
      table: "campaigns",
      constraint: "campaigns_project_owner_fkey",
      old: "campaigns_project_id_fkey",
      parent: "projects",
      column: "project_id",
      insert: `insert into campaigns(id,user_id,project_id) values('${bad}','${a}','${unusedB}')`,
      orphan: `insert into campaigns(id,user_id,project_id) values('${bad}','${a}','${randomUUID()}')`,
      update: `update campaigns set project_id='${unusedB}' where id='${ca}'`,
      cleanup: `delete from campaigns where id='${bad}'`,
    },
    {
      table: "experiments",
      constraint: "experiments_campaign_owner_fkey",
      old: "experiments_campaign_id_fkey",
      parent: "campaigns",
      column: "campaign_id",
      insert: `insert into experiments(id,user_id,campaign_id,platform_id,published_at) values('${bad}','${a}','${cb}','twitter',now())`,
      orphan: `insert into experiments(id,user_id,campaign_id,platform_id,published_at) values('${bad}','${a}','${randomUUID()}','twitter',now())`,
      update: `update experiments set campaign_id='${cb}' where id='${ea}'`,
      cleanup: `delete from experiments where id='${bad}'`,
    },
    {
      table: "outcomes",
      constraint: "outcomes_experiment_owner_fkey",
      old: "outcomes_experiment_id_fkey",
      parent: "experiments",
      column: "experiment_id",
      insert: `insert into outcomes(id,user_id,experiment_id,checkpoint) values('${bad}','${a}','${eb}','24h')`,
      orphan: `insert into outcomes(id,user_id,experiment_id,checkpoint) values('${bad}','${a}','${randomUUID()}','24h')`,
      update: `update outcomes set experiment_id='${eb}' where id='${oa}'`,
      cleanup: `delete from outcomes where id='${bad}'`,
    },
    {
      table: "tasks",
      constraint: "tasks_campaign_owner_fkey",
      old: "tasks_campaign_id_fkey",
      parent: "campaigns",
      column: "campaign_id",
      insert: `insert into tasks(campaign_id,id,user_id,kind,status) values('${cb}','bad-task','${a}','publish','done')`,
      orphan: `insert into tasks(campaign_id,id,user_id,kind,status) values('${randomUUID()}','bad-task','${a}','publish','done')`,
      update: `update tasks set campaign_id='${cb}' where campaign_id='${ca}' and id='valid-a'`,
      cleanup: "delete from tasks where id='bad-task'",
    },
  ];
  const downgrade = async () => {
    for (const link of links)
      await sql(`alter table public.${link.table} drop constraint ${link.constraint};`);
    await sql(
      "drop index public.campaigns_id_user_key; drop index public.experiments_id_user_key;"
    );
  };
  const snapshot = () =>
    scalar(`select jsonb_build_object(
    'campaigns',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]'::jsonb) from campaigns c),
    'experiments',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from experiments e),
    'outcomes',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]'::jsonb) from outcomes o),
    'tasks',(select coalesce(jsonb_agg(to_jsonb(t) order by campaign_id,id),'[]'::jsonb) from tasks t)
  )::text;`);
  const assertAtomicAbort = async () => {
    const before = await snapshot();
    await assert.rejects(file(migration), /workspace_ownership_preflight_failed/);
    assert.equal(
      await snapshot(),
      before,
      "preflight must not delete or reassign existing rows"
    );
    assert.equal(
      await scalar(
        "select to_regclass('public.campaigns_id_user_key') is null and to_regclass('public.experiments_id_user_key') is null"
      ),
      "t",
      "failed preflight must leave no partial unique indexes"
    );
    assert.equal(
      await scalar(
        "select count(*) from pg_constraint where connamespace='public'::regnamespace and conname in ('campaigns_project_owner_fkey','experiments_campaign_owner_fkey','outcomes_experiment_owner_fkey','tasks_campaign_owner_fkey')"
      ),
      "0",
      "failed preflight must leave no partial ownership constraints"
    );
  };

  // Reproduce the historical row-RLS-only attack in an isolated legacy schema,
  // then prove the production-safe migration refuses to hide or rewrite it.
  for (const link of links) {
    await downgrade();
    await asOwner(a, link.insert);
    if (link.table === "campaigns") {
      assert.equal(
        (await asOwner(a, `select count(*) from projects where id='${unusedB}'`))
          .split("\n")
          .at(-1),
        "0",
        "attacker cannot read the victim project"
      );
      await assert.rejects(
        asOwner(b, `insert into campaigns(user_id,project_id) values('${b}','${unusedB}')`),
        /duplicate key/
      );
    }
    await assertAtomicAbort();
    await sql(link.cleanup);
    await file(migration);
  }
  checks.push(
    "four legacy cross-owner RLS attacks reproduce; preflight aborts without data changes"
  );

  // Older partial installations may also have missing-parent rows. Do not
  // silently repair those either: each of the four orphan shapes must abort.
  for (const link of links) {
    await downgrade();
    await sql(
      `alter table public.${link.table} drop constraint ${link.old}; ${link.orphan};`
    );
    await assertAtomicAbort();
    await sql(
      `${link.cleanup}; alter table public.${link.table} add constraint ${link.old} foreign key(${link.column}) references public.${link.parent}(id) on delete cascade;`
    );
    await file(migration);
  }
  checks.push(
    "all four orphan preflights abort transactionally without automatic deletion"
  );

  // A reused constraint name must not turn an incorrect object into a false
  // successful installation, and DDL before the conflict must roll back too.
  await downgrade();
  await sql(
    "alter table campaigns add constraint campaigns_project_owner_fkey check(true);"
  );
  await assert.rejects(file(migration), /workspace_ownership_constraint_conflict/);
  assert.equal(
    await scalar(
      "select to_regclass('public.campaigns_id_user_key') is null and to_regclass('public.experiments_id_user_key') is null"
    ),
    "t"
  );
  assert.equal(
    await scalar(
      "select contype='c' from pg_constraint where conrelid='public.campaigns'::regclass and conname='campaigns_project_owner_fkey'"
    ),
    "t",
    "conflicting existing constraint is not silently replaced"
  );
  await sql("alter table campaigns drop constraint campaigns_project_owner_fkey;");
  await file(migration);
  checks.push("constraint-name conflict fails closed and rolls back partial DDL");

  for (const link of links) {
    await assert.rejects(asOwner(a, link.insert), /foreign key constraint/);
    await assert.rejects(asOwner(a, link.update), /foreign key constraint/);
  }
  checks.push(
    "authenticated cross-owner inserts and parent-id updates rejected on all four links"
  );
  await file("supabase/schema.sql");
  const deleteDefinition = await sql(
    "select pg_get_functiondef('public.delete_postbeacon_user_data(uuid)'::regprocedure)"
  );
  assert.match(
    deleteDefinition,
    /perform 1 from public\.projects[\s\S]*order by id for update;/
  );
  assert.ok(
    deleteDefinition.indexOf("perform 1 from public.projects") <
      deleteDefinition.indexOf("delete from public.agent_runs"),
    "base schema reapplication must retain the worker/delete project-first lock order"
  );
  checks.push("base schema alone preserves project-first account deletion lock order");

  const settings = {
    enabled: true,
    brief: { mode: "product-led", sources: [] },
    searchQueries: ["fictional public test"],
    allowedDomains: ["example.org"],
  };
  const settingsSql = `'${JSON.stringify(settings)}'::jsonb`;
  const payloadSql = `'${JSON.stringify({ provider: "openai", input: settings.brief })}'::jsonb`;
  for (let index = 0; index < 3; index++) {
    const owner = randomUUID(),
      project = randomUUID();
    await sql(
      `insert into auth.users values('${owner}'); insert into projects(id,user_id) values('${project}','${owner}');`
    );
    const mission = await scalar(
      `set role service_role; select save_agent_mission('${owner}','${project}','base-schema-qa',${settingsSql},null)->>'id';`
    );
    const run = await scalar(
      `set role service_role; select reserve_agent_mission_run('${owner}','${mission}','base-schema-qa',1,${payloadSql})->>'id';`
    );
    const lease = await scalar(
      `set role service_role; select transition_agent_run('${owner}','${run}','claim')->>'lease_token';`
    );
    const version = await scalar(
      `select updated_at::text from projects where id='${project}';`
    );
    await Promise.all([
      sql(
        `begin; set role service_role; select transition_agent_mission_run('${owner}','${run}','search','${lease}',null,'${version}'::timestamptz); select pg_sleep(0.15); commit;`
      ),
      sql(`set role service_role; select delete_postbeacon_user_data('${owner}');`),
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
    "base schema alone retains non-deadlocking worker checkpoint/account-delete concurrency"
  );
  await file(migration);
  await audit();
  checks.push(
    "base schema and ownership migration safely reapply with legitimate workspace data"
  );

  await asOwner(a, `delete from projects where id='${pa}'`);
  for (const table of ["campaigns", "experiments", "outcomes", "tasks"]) {
    assert.equal(await scalar(`select count(*) from ${table} where user_id='${a}'`), "0");
    assert.equal(await scalar(`select count(*) from ${table} where user_id='${b}'`), "1");
  }
  checks.push(
    "project cascade deletes its whole owner chain while preserving the other account"
  );
  await sql(`delete from auth.users where id in('${a}','${b}');`);
  for (const table of ["projects", "campaigns", "experiments", "outcomes", "tasks"])
    assert.equal(
      await scalar(`select count(*) from ${table} where user_id in('${a}','${b}')`),
      "0"
    );
  checks.push("auth-user cascades still remove all same-owner workspace descendants");
  return checks;
}
