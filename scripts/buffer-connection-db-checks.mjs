// Only the disposable socket-only PostgreSQL harness calls this module.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyBufferConnections({ sql, file }) {
  const checks = [];
  const scalar = async (query) => (await sql(query)).split("\n").at(-1);
  const json = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const migration = "supabase/migrations/20261026_buffer_connections.sql";
  const audit = async () => {
    const report = await file("supabase/audit-buffer-connections.sql");
    assert.ok(
      !report.stdout.includes("FAIL") && report.stdout.match(/PASS/g)?.length === 8
    );
  };
  await file(migration);
  await file(migration);
  await audit();
  checks.push("Buffer connection migration rerun and eight-row audit");
  await sql("grant select on public.buffer_connection_secrets to public;");
  await assert.rejects(
    audit,
    "audit must detect effective client privileges inherited through PUBLIC"
  );
  await sql("revoke select on public.buffer_connection_secrets from public;");
  await sql(
    'create policy "unsafe audit fixture" on public.buffer_connections for select using(true);'
  );
  await assert.rejects(audit, "audit must reject an extra permissive metadata policy");
  await sql('drop policy "unsafe audit fixture" on public.buffer_connections;');
  await audit();
  checks.push(
    "Buffer audit rejects inherited PUBLIC privileges and extra permissive metadata policies"
  );
  const a = randomUUID(),
    b = randomUUID();
  await sql(`insert into auth.users values('${a}'),('${b}');`);
  const rpc = async (owner, action, connection, revision, data = {}) => {
    const result = await scalar(
      `set role service_role; select buffer_connection_transition('${owner}','${action}',${connection ? `'${connection}'` : "null"},${revision ?? "null"},${json(data)});`
    );
    return result ? JSON.parse(result) : null;
  };
  const state = () => ({
    state_id: randomUUID(),
    state_hash: randomUUID().replaceAll("-", "").repeat(2),
    binding_hash: randomUUID().replaceAll("-", "").repeat(2),
    verifier_ciphertext: "v1.fake-verifier",
  });
  const begin = async (advanceClock = true) => {
    if (advanceClock)
      await sql(
        `update buffer_connections set control_started_at=clock_timestamp()-interval '31 seconds' where user_id='${a}'`
      );
    const value = state();
    const started = await rpc(a, "begin", randomUUID(), null, value);
    return { value, connection: started.connection };
  };
  const stage = (connection, value, owner = a) =>
    rpc(owner, "stage-code", connection.id, connection.revision, {
      ...value,
      code_ciphertext: "v1.fake-code",
    });
  const claim = (connection, value, owner = a) =>
    rpc(owner, "claim-code", connection.id, connection.revision, {
      state_id: value.state_id,
      binding_hash: value.binding_hash,
    });
  const complete = (connection, value) =>
    rpc(a, "complete-code", connection.id, connection.revision, {
      state_id: value.state_id,
      binding_hash: value.binding_hash,
      access_ciphertext: "v1.fake-access",
      refresh_ciphertext: "v1.fake-refresh",
      expires_at: new Date(Date.now() + 30000).toISOString(),
      account_id: "fictional-buffer-account",
      account_label: "Fictional workspace",
      channels: [
        {
          id: "fictional-channel",
          name: "Fictional channel",
          service: "twitter",
          organizationId: "fictional-org",
        },
      ],
    });
  const starts = await Promise.allSettled(Array.from({ length: 6 }, () => begin(false)));
  const winners = starts.filter((result) => result.status === "fulfilled");
  assert.equal(
    winners.length,
    1,
    "parallel OAuth begin must preserve a single pending flow"
  );
  assert.equal(starts.filter((result) => result.status === "rejected").length, 5);
  let { value, connection } = winners[0].value;
  await assert.rejects(begin(false), /buffer_rate_limited/);
  assert.equal(
    await scalar(
      `select count(*) from buffer_oauth_states where id='${value.state_id}' and user_id='${a}'`
    ),
    "1",
    "rate-limited OAuth begin must not erase the pending state"
  );
  checks.push(
    "distributed thirty-second OAuth begin reservation preserves the winning pending flow"
  );
  assert.equal(
    await scalar(`select buffer_data_initialized from entitlements where user_id='${a}'`),
    "t"
  );
  assert.equal(await stage(connection, { ...value, state_hash: "0".repeat(64) }), null);
  assert.equal(await stage(connection, { ...value, binding_hash: "0".repeat(64) }), null);
  assert.equal(await stage(connection, value, b), null);
  assert.equal((await stage(connection, value)).status, "staged");
  assert.equal(await stage(connection, value), null);
  assert.equal(await claim(connection, { ...value, binding_hash: "0".repeat(64) }), null);
  assert.equal(await claim(connection, value, b), null);
  const claims = await Promise.all(
    Array.from({ length: 6 }, () => claim(connection, value))
  );
  assert.equal(
    claims.filter(Boolean).length,
    1,
    "code exchange must be claimed once across processes"
  );
  connection = await complete(connection, value);
  assert.equal(connection.status, "connected");
  assert.equal(
    await complete({ ...connection, revision: connection.revision - 1 }, value),
    null
  );
  checks.push("OAuth state/cookie/owner binding and exactly-once code exchange claim");
  await assert.rejects(
    rpc(a, "claim-channels", connection.id, connection.revision),
    /buffer_rate_limited/
  );
  await sql(
    `update buffer_connections set control_started_at=clock_timestamp()-interval '31 seconds' where id='${connection.id}'`
  );
  const channelClaims = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      rpc(a, "claim-channels", connection.id, connection.revision)
    )
  );
  assert.equal(channelClaims.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(channelClaims.filter((result) => result.status === "rejected").length, 5);
  await assert.rejects(
    rpc(a, "claim-channels", connection.id, connection.revision),
    /buffer_rate_limited/
  );
  assert.equal(
    await scalar(
      `select count(*) from buffer_connection_secrets where connection_id='${connection.id}'`
    ),
    "1",
    "denied metadata refresh must not wipe live credentials"
  );
  checks.push(
    "channel reads reserve once across processes and failed reads still consume the cooldown"
  );

  assert.equal(
    await scalar(
      `set role authenticated; set "request.jwt.claim.sub"='${b}'; select count(*) from buffer_connections where user_id='${a}';`
    ),
    "0"
  );
  assert.equal(
    await scalar(
      `set role authenticated; set "request.jwt.claim.sub"='${a}'; select count(*) from buffer_connections;`
    ),
    "1"
  );
  for (const table of ["buffer_connection_secrets", "buffer_oauth_states"])
    await assert.rejects(
      sql(`set role authenticated; select * from ${table};`),
      /permission denied/
    );
  await assert.rejects(
    sql(`set role authenticated; update buffer_connections set revision=revision+1;`),
    /permission denied/
  );
  await assert.rejects(
    sql(
      `set role authenticated; select buffer_connection_transition('${a}','disconnect','${connection.id}',null,'{}');`
    ),
    /permission denied/
  );
  await assert.rejects(
    sql(
      `set role service_role; insert into buffer_connection_secrets(connection_id,user_id,access_ciphertext,refresh_ciphertext,expires_at) values('${connection.id}','${b}','fake','fake',now());`
    ),
    /foreign key constraint|duplicate key/
  );
  checks.push(
    "owner-only metadata and server-only vault/state/RPC with composite owner references"
  );

  const refreshes = await Promise.all(
    Array.from({ length: 6 }, () =>
      rpc(a, "claim-refresh", connection.id, connection.revision)
    )
  );
  const reserved = refreshes.filter((row) => row?.refresh_ciphertext);
  assert.equal(reserved.length, 1, "one process owns the rotating refresh token");
  const lease = reserved[0].lease_token;
  assert.equal(
    await rpc(a, "complete-refresh", connection.id, connection.revision, {
      lease_token: randomUUID(),
    }),
    null
  );
  const tokens = {
    lease_token: lease,
    access_ciphertext: "v1.new-access",
    refresh_ciphertext: "v1.new-refresh",
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };
  assert.equal(
    (await rpc(a, "complete-refresh", connection.id, connection.revision, tokens)).revision,
    connection.revision
  );
  assert.equal(
    await rpc(a, "complete-refresh", connection.id, connection.revision, tokens),
    null
  );
  assert.equal(
    await scalar(
      `select refresh_ciphertext from buffer_connection_secrets where connection_id='${connection.id}'`
    ),
    "v1.new-refresh"
  );
  checks.push(
    "distributed refresh lease stores rotated tokens once and rejects stale completion"
  );

  await sql(
    `update buffer_connection_secrets set expires_at=now()-interval '1 second' where connection_id='${connection.id}';`
  );
  const ambiguous = await rpc(a, "claim-refresh", connection.id, connection.revision);
  await sql(
    `update buffer_connection_secrets set lease_until=now()-interval '1 second' where connection_id='${connection.id}';`
  );
  const blocked = await rpc(a, "claim-refresh", connection.id, connection.revision);
  assert.equal(blocked.busy, true);
  assert.equal(blocked.expired, true);
  assert.equal(blocked.lease_token, ambiguous.lease_token);
  connection = await rpc(a, "reauth", connection.id, connection.revision, {
    lease_token: ambiguous.lease_token,
  });
  assert.equal(connection.status, "reauth-required");
  assert.equal(
    await scalar(`select count(*) from buffer_connection_secrets where user_id='${a}'`),
    "0"
  );
  checks.push(
    "ambiguous expired refresh cannot obtain a replacement lease and requires reauthorization"
  );

  ({ value, connection } = await begin());
  await sql(
    `update buffer_oauth_states set created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' where id='${value.state_id}';`
  );
  assert.equal(await stage(connection, value), null);
  ({ value, connection } = await begin());
  await stage(connection, value);
  await claim(connection, value);
  const disconnected = await rpc(a, "disconnect", connection.id, null);
  assert.equal(disconnected.status, "disconnected");
  assert.equal(await complete(connection, value), null);
  assert.equal(
    await scalar(`select count(*) from buffer_connection_secrets where user_id='${a}'`),
    "0"
  );
  assert.equal(
    await scalar(`select count(*) from buffer_oauth_states where user_id='${a}'`),
    "0"
  );
  checks.push(
    "ten-minute OAuth expiry and disconnect revision fence late exchanges while wiping secrets"
  );

  const oldFlow = await begin();
  await stage(oldFlow.connection, oldFlow.value);
  await claim(oldFlow.connection, oldFlow.value);
  const newFlow = await begin();
  assert.equal(await complete(oldFlow.connection, oldFlow.value), null);
  assert.equal(
    await rpc(a, "reauth", oldFlow.connection.id, oldFlow.connection.revision),
    null
  );
  assert.equal(
    await scalar(
      `select count(*) from buffer_oauth_states where id='${newFlow.value.state_id}' and user_id='${a}'`
    ),
    "1"
  );
  assert.ok(newFlow.connection.revision > oldFlow.connection.revision);
  checks.push(
    "new OAuth begin fences old exchange failure cleanup without erasing the new authorization"
  );

  ({ value, connection } = await begin());
  await stage(connection, value);
  await claim(connection, value);
  connection = await complete(connection, value);
  await file(migration);
  await audit();
  assert.equal(
    await scalar(`select revision from buffer_connections where id='${connection.id}'`),
    String(connection.revision)
  );
  await sql(`delete from auth.users where id in('${a}','${b}');`);
  for (const table of [
    "buffer_connections",
    "buffer_connection_secrets",
    "buffer_oauth_states",
  ])
    assert.equal(
      await scalar(`select count(*) from ${table} where user_id in('${a}','${b}')`),
      "0"
    );
  checks.push(
    "Buffer reinstall preserves records and auth deletion cascades metadata/vault/states"
  );
  return checks;
}
