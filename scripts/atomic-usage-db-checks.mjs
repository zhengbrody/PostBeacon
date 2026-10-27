// Disposable local PostgreSQL harness only; no credentials or production URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyAtomicUsage({ sql, file }) {
  const scalar = async (query) => (await sql(query)).split("\n").at(-1);
  const service = (query) => scalar(`set role service_role; ${query}`);
  const migration = "supabase/migrations/20261026_atomic_usage.sql";
  await file(migration);
  await file(migration);
  const audit = await file("supabase/audit-usage.sql");
  assert.ok(!audit.stdout.includes("FAIL") && audit.stdout.match(/PASS/g)?.length === 4);
  const a = randomUUID(),
    b = randomUUID(),
    pro = randomUUID();
  await sql(`insert into auth.users values ('${a}'),('${b}'),('${pro}');
    insert into entitlements(user_id,plan,launches_used)
      values ('${a}','free',3),('${pro}','pro',5);`);
  const reserve = (user, limit = 7) =>
    service(`select postbeacon_reserve_daily_call('${user}',${limit});`);
  const reservations = await Promise.all(Array.from({ length: 20 }, () => reserve(a)));
  assert.equal(reservations.filter((value) => value === "t").length, 7);
  assert.equal(
    await scalar(`select calls_today from entitlements where user_id='${a}';`),
    "7"
  );
  assert.equal(await reserve(b), "t", "one owner's quota must not consume another's");
  assert.equal(
    await scalar(`select launches_used from entitlements where user_id='${a}';`),
    "3"
  );

  await sql(`update entitlements set calls_today=100,
    calls_date=(clock_timestamp() at time zone 'UTC')::date - 1 where user_id='${a}';`);
  assert.equal(await reserve(a), "t");
  assert.equal(
    await scalar(`select calls_today from entitlements where user_id='${a}';`),
    "1"
  );
  assert.equal(
    await scalar(`select calls_date=(clock_timestamp() at time zone 'UTC')::date
    from entitlements where user_id='${a}';`),
    "t"
  );

  const increments = await Promise.all(
    Array.from({ length: 24 }, () => service(`select postbeacon_increment_launch('${a}');`))
  );
  assert.equal(new Set(increments).size, 24, "concurrent completions must each increment");
  assert.equal(
    await scalar(`select launches_used||':'||calls_today||':'||plan
    from entitlements where user_id='${a}';`),
    "27:1:free"
  );
  assert.equal(await reserve(pro, 1), "t");
  assert.equal(await reserve(pro, 1), "t");
  assert.equal(
    await scalar(`select calls_today||':'||launches_used||':'||plan
    from entitlements where user_id='${pro}';`),
    "0:5:pro"
  );

  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(
      sql(`set role ${role};
      select postbeacon_reserve_daily_call('${a}',100000);`),
      /permission denied/
    );
    await assert.rejects(
      sql(`set role ${role};
      select postbeacon_increment_launch('${a}');`),
      /permission denied/
    );
  }
  for (const limit of [0, -1, 100001, "null"])
    await assert.rejects(reserve(a, limit), /invalid_usage_request/);
  await assert.rejects(
    service("select postbeacon_increment_launch(null);"),
    /invalid_usage_request/
  );
  await sql(`update entitlements set calls_today=-1 where user_id='${a}';`);
  await assert.rejects(reserve(a), /invalid_usage_state/);

  // No historical entitlement or counter changes when rerunning the migration.
  await file(migration);
  assert.equal(
    await scalar(`select launches_used from entitlements where user_id='${a}';`),
    "27"
  );
  await sql(`delete from auth.users where id in ('${a}','${b}','${pro}');`);
  assert.equal(
    await scalar(`select count(*) from entitlements
    where user_id in ('${a}','${b}','${pro}');`),
    "0"
  );
  return [
    "atomic usage migration rerun and four-row audit",
    "parallel daily cap and independent user allowance",
    "database-owned UTC daily rollover",
    "parallel successful-launch increments preserve plan and daily counts",
    "existing Pro daily exemption unchanged",
    "usage RPCs reject browser roles and invalid requests",
    "usage entitlement cascade and rerun preservation",
  ];
}
