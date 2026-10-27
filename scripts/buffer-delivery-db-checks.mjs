// Isolated PostgreSQL only. No provider, credential, production URL or env read.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function verifyBufferDeliveries({ sql, file }) {
  const scalar = async (q) => (await sql(q)).split("\n").at(-1);
  const service = (q) => scalar(`set role service_role; ${q}`);
  const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const migrate = "supabase/migrations/20261026_buffer_deliveries.sql";
  await file(migrate);
  await file(migrate);
  const audit = await file("supabase/audit-buffer-deliveries.sql");
  assert.ok(
    !audit.stdout.includes("FAIL") && audit.stdout.match(/PASS/g)?.length === 8,
    "eight delivery audit rows must pass"
  );
  const a = randomUUID(),
    b = randomUUID(),
    pa = randomUUID(),
    pb = randomUUID(),
    ca = randomUUID(),
    cb = randomUUID();
  await sql(`insert into auth.users values('${a}'),('${b}');
    insert into projects(id,user_id,updated_at)values('${pa}','${a}','2026-01-01T00:00:00Z'),('${pb}','${b}','2026-01-01T00:00:00Z');
    insert into buffer_connections(id,user_id,status,buffer_account_id)values('${ca}','${a}','connected','synthetic-account'),('${cb}','${b}','connected','synthetic-account');`);
  const due = new Date(Date.now() + 86_400_000).toISOString(),
    stamp = "2026-01-01T00:00:00Z",
    key = "a".repeat(64);
  let n = 0;
  const snapshot = (owner = a, project = pa, connection = ca) => ({
    approvalNonce: randomUUID(),
    projectId: project,
    projectUpdatedAt: stamp,
    connectionId: connection,
    connectionRevision: 1,
    channelId: "synthetic-channel",
    channelName: "Synthetic channel",
    platformId: "twitter",
    postIdx: 0,
    body: "A synthetic post for DB acceptance only.",
    scheduledAt: due,
    timeZone: "UTC",
    contextDigest: "b".repeat(64),
    draftDigest: "c".repeat(64),
    accountQuotaKey: key,
  });
  const prepare = async (owner = a, project = pa, connection = ca, override = {}) => {
    const hash = (++n).toString(16).padStart(64, "0"),
      snap = {
        ...snapshot(owner, project, connection),
        body: `A synthetic post for DB acceptance only. Variant ${n}.`,
        ...override,
      };
    const row = JSON.parse(
      await service(
        `select prepare_buffer_delivery('${owner}','${project}','${connection}',1,'${stamp}','${hash}','${key}',${json(snap)});`
      )
    );
    return { id: row.id, hash, row };
  };
  const claim = (delivery, owner = a, revision = 1) =>
    service(
      `select claim_buffer_delivery('${owner}','${delivery.id}','${delivery.hash}','${stamp}',${revision});`
    );
  const prepared = await prepare();
  assert.equal(
    await service(
      `select claim_buffer_delivery('${a}','${prepared.id}',null,'${stamp}',1);`
    ),
    ""
  );
  const duplicate = await service(
    `select prepare_buffer_delivery('${a}','${pa}','${ca}',1,'${stamp}','${prepared.hash}','${key}',${json(prepared.row.snapshot)})->>'id';`
  );
  assert.equal(duplicate, prepared.id);
  await assert.rejects(
    prepare(a, pa, ca, { body: prepared.row.snapshot.body }),
    /duplicate_active_delivery/
  );
  const claims = await Promise.all(Array.from({ length: 8 }, () => claim(prepared)));
  assert.equal(
    claims.filter(Boolean).length,
    1,
    "exactly one concurrent approval may consume the external attempt"
  );
  const attempted = JSON.parse(claims.find(Boolean));
  assert.equal(
    await scalar(
      `select reserved_deliveries from buffer_delivery_daily_usage where user_id='${a}';`
    ),
    "1"
  );
  assert.equal(await claim(prepared), "");
  const finish = (token, status = "scheduled", id = "synthetic-provider-post") =>
    service(
      `select finish_buffer_delivery('${a}','${prepared.id}','${token}','${status}','${id}');`
    );
  assert.equal(await finish(randomUUID()), "");
  assert.ok(await finish(attempted.attempt_token));
  await assert.rejects(
    prepare(a, pa, ca, { body: prepared.row.snapshot.body }),
    /duplicate_active_delivery/
  );
  assert.equal(
    await finish(attempted.attempt_token, "failed"),
    "",
    "late callbacks cannot rewrite a final receipt"
  );
  assert.equal(
    await service(`select cancel_buffer_delivery('${a}','${prepared.id}');`),
    "",
    "local cancellation never recalls an attempted remote post"
  );
  const unsent = await prepare();
  assert.ok(await service(`select cancel_buffer_delivery('${a}','${unsent.id}');`));
  assert.equal(await claim(unsent), "");
  const expired = await prepare();
  await sql(
    `update buffer_deliveries set expires_at=now()-interval '1 second' where id='${expired.id}';`
  );
  assert.ok(
    await prepare(a, pa, ca, { body: expired.row.snapshot.body }),
    "a projected-expired preview still stored as awaiting must not block a fresh approval"
  );
  assert.equal(await claim(expired), "");
  assert.equal(
    await scalar(`select status from buffer_deliveries where id='${expired.id}';`),
    "expired"
  );
  const secondProject = randomUUID();
  await sql(
    `insert into projects(id,user_id,updated_at)values('${secondProject}','${a}','${stamp}');`
  );
  const parallel = await Promise.allSettled([
    prepare(a, pa, ca, { body: "Parallel synthetic duplicate." }),
    prepare(a, secondProject, ca, { body: "Parallel synthetic duplicate." }),
  ]);
  assert.equal(
    parallel.filter((result) => result.status === "fulfilled").length,
    1,
    "shared connection lock serializes identical prepares across two projects"
  );
  const parallelReceipt = parallel.find((result) => result.status === "fulfilled");
  await service(`select cancel_buffer_delivery('${a}','${parallelReceipt.value.id}');`);
  await sql(`delete from projects where id='${secondProject}';`);
  const stale = await prepare();
  await sql(`update projects set updated_at='2026-01-02T00:00:00Z' where id='${pa}';`);
  await assert.rejects(claim(stale), /draft_conflict/);
  await sql(
    `update projects set updated_at='${stamp}' where id='${pa}'; update buffer_connections set revision=2 where id='${ca}';`
  );
  await assert.rejects(claim(stale), /connection_conflict/);
  await sql(`update buffer_connections set revision=1 where id='${ca}';`);
  await assert.rejects(prepare(a, pb, ca), /draft_conflict/);
  await assert.rejects(prepare(a, pa, cb), /connection_conflict/);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(
      sql(
        `set role ${role};select claim_buffer_delivery('${a}','${prepared.id}','${prepared.hash}','${stamp}',1);`
      ),
      /permission denied/
    );
    await assert.rejects(
      sql(`set role ${role};update buffer_deliveries set status='published';`),
      /permission denied/
    );
  }
  assert.equal(
    await scalar(
      `set role authenticated;set "request.jwt.claim.sub"='${b}';select count(*) from buffer_deliveries where user_id='${a}';`
    ),
    "0"
  );
  // First already consumed one allowance. Four further independent approvals fit;
  // the same provider-account allowance then blocks the other local owner too.
  for (let i = 0; i < 4; i++) assert.ok(await claim(await prepare()));
  await assert.rejects(claim(await prepare()), /delivery_budget_exhausted/);
  await assert.rejects(claim(await prepare(b, pb, cb), b), /delivery_budget_exhausted/);
  const read = JSON.parse(
    await service(`select claim_buffer_delivery_read('${a}','${prepared.id}');`)
  );
  await assert.rejects(
    service(`select claim_buffer_delivery_read('${a}','${prepared.id}');`),
    /delivery_read_limited/
  );
  assert.equal(
    await service(
      `select observe_buffer_delivery('${a}','${prepared.id}','${randomUUID()}','published',now());`
    ),
    ""
  );
  assert.ok(
    await service(
      `select observe_buffer_delivery('${a}','${prepared.id}','${read.read_token}','published',now());`
    )
  );
  assert.equal(
    await service(
      `select observe_buffer_delivery('${a}','${prepared.id}',null,'scheduled',null);`
    ),
    "",
    "cleared/NULL read tokens never authorize an observation"
  );
  await sql(
    `update buffer_deliveries set read_started_at=now()-interval '31 seconds' where id='${prepared.id}';`
  );
  const read2 = JSON.parse(
    await service(`select claim_buffer_delivery_read('${a}','${prepared.id}');`)
  );
  await service(
    `select observe_buffer_delivery('${a}','${prepared.id}','${read2.read_token}','scheduled',null);`
  );
  assert.equal(
    await scalar(`select status from buffer_deliveries where id='${prepared.id}';`),
    "published",
    "a late scheduled observation cannot undo verified sent status"
  );
  await sql(`delete from projects where id='${pa}';`);
  assert.equal(
    await scalar(`select count(*) from buffer_deliveries where user_id='${a}';`),
    "0"
  );
  assert.equal(
    await scalar(
      `select reserved_deliveries from buffer_delivery_daily_usage where user_id='${a}';`
    ),
    "5"
  );
  await sql(`delete from auth.users where id in('${a}','${b}');`);
  assert.equal(
    await scalar(
      `select count(*) from buffer_delivery_daily_usage where user_id in('${a}','${b}');`
    ),
    "0"
  );
  assert.equal(
    await scalar(
      `select reserved_deliveries from buffer_delivery_account_daily_usage where account_quota_key='${key}';`
    ),
    "5"
  );
  const c = randomUUID(),
    d = randomUUID(),
    pc = randomUUID(),
    pd = randomUUID(),
    cc = randomUUID(),
    cd = randomUUID();
  await sql(`insert into auth.users values('${c}'),('${d}');
    insert into projects(id,user_id,updated_at)values('${pc}','${c}','${stamp}'),('${pd}','${d}','${stamp}');
    insert into buffer_connections(id,user_id,status,buffer_account_id)values('${cc}','${c}','connected','synthetic-second-account'),('${cd}','${d}','connected','synthetic-second-account');
    update buffer_delivery_daily_totals set reserved_deliveries=99;
    update buffer_delivery_account_daily_usage set reserved_deliveries=0;`);
  const global = await Promise.allSettled([
    claim(await prepare(c, pc, cc), c),
    claim(await prepare(d, pd, cd), d),
  ]);
  assert.equal(
    global.filter((result) => result.status === "fulfilled" && result.value).length,
    1,
    "the global allowance is atomic across owners"
  );
  assert.equal(
    await scalar("select reserved_deliveries from buffer_delivery_daily_totals;"),
    "100"
  );
  const stateId = randomUUID(),
    stateHash = stateId.replaceAll("-", "").repeat(2);
  await sql(`insert into buffer_connection_secrets(connection_id,user_id,access_ciphertext,refresh_ciphertext,expires_at)
    values('${cc}','${c}','local-fixture-not-a-token','local-fixture-not-a-token',now()+interval '1 hour');
    insert into buffer_oauth_states(id,user_id,connection_id,connection_revision,state_hash,binding_hash,verifier_ciphertext,created_at,expires_at)
    values('${stateId}','${c}','${cc}',1,'${stateHash}','${"e".repeat(64)}','local-fixture-not-a-verifier',now(),now()+interval '10 minutes');`);
  await file("supabase/migrations/20261026_buffer_data_rights.sql");
  await file("supabase/schema.sql");
  const rightsAudit = await file("supabase/audit-buffer-data-rights.sql");
  assert.ok(
    !rightsAudit.stdout.includes("FAIL") && rightsAudit.stdout.match(/PASS/g)?.length === 5,
    "data-rights audit remains green after base schema reapply"
  );
  await service(`select delete_postbeacon_user_data('${c}');`);
  for (const table of [
    "buffer_connections",
    "buffer_connection_secrets",
    "buffer_oauth_states",
    "buffer_deliveries",
    "buffer_delivery_daily_usage",
  ])
    assert.equal(
      await scalar(`select count(*) from ${table} where user_id='${c}';`),
      "0",
      `${table} covered after base schema reapply`
    );
  assert.equal(
    await scalar(`select count(*) from buffer_connections where user_id='${d}';`),
    "1",
    "account cleanup must not touch another owner"
  );
  assert.equal(
    await scalar("select reserved_deliveries from buffer_delivery_daily_totals;"),
    "100"
  );
  await sql(`delete from auth.users where id in('${c}','${d}');`);
  return [
    "Buffer delivery migration rerun and eight-row audit",
    "concurrent approval is one-shot and exact frozen hash idempotent",
    "fresh context hashes cannot duplicate active account/channel/text/time deliveries",
    "attempt tokens fence late completion and no retry after ambiguity",
    "unsent cancellation and expiry never create an attempt",
    "project-version connection-revision and composite-owner fences",
    "service-only transitions owner RLS and no client writes",
    "atomic per-user shared-account and global delivery allowances",
    "read allowance and nonce-fenced monotonic provider observations",
    "local deletion cascades receipts without resetting shared account counters",
    "Buffer data-rights migration and base schema reapply preserve complete owner cleanup",
  ];
}
