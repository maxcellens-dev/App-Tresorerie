/* Isolated PostgreSQL/WASM validation. Pass a temp folder containing @electric-sql/pglite.
   No production connection, no application dependency. The resync function is a failure-injection stub. */
const { PGlite } = require(require('path').join(process.argv[2], 'node_modules/@electric-sql/pglite'));
const { readFileSync } = require('fs');
const assert = require('node:assert/strict');
const db = new PGlite();
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE accounts(id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE credits(id uuid PRIMARY KEY, profile_id uuid, account_id uuid, is_active boolean DEFAULT true,
      is_simulation boolean DEFAULT false, updated_at timestamptz DEFAULT '2026-01-01', schedule_hash text);
    CREATE TABLE credit_members(credit_id uuid, user_id uuid, role text);
    CREATE FUNCTION public.credit_role(c uuid) RETURNS text LANGUAGE sql AS $$ SELECT role FROM credit_members WHERE credit_id=c AND user_id=auth.uid() $$;
    CREATE TABLE credit_events(id uuid PRIMARY KEY, credit_id uuid REFERENCES credits(id) ON DELETE CASCADE, amount numeric);
    CREATE TABLE transactions(id uuid PRIMARY KEY, materialized_from uuid REFERENCES transactions(id) ON DELETE SET NULL);
    CREATE TABLE credit_schedule(credit_id uuid REFERENCES credits(id), kind text NOT NULL, period integer NOT NULL,
      date date NOT NULL, amount numeric NOT NULL, account_id uuid, category_id uuid, note text, PRIMARY KEY(credit_id, kind, period));
    ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
    CREATE POLICY credits_read ON credits FOR SELECT USING (profile_id=auth.uid() OR credit_role(id) IN ('write','read'));
    CREATE POLICY credits_write ON credits FOR UPDATE USING (profile_id=auth.uid() OR credit_role(id)='write');
    ALTER TABLE credit_schedule ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.resync_credit_materialized(uuid,date) RETURNS integer LANGUAGE plpgsql AS $$
    BEGIN IF current_setting('test.resync_fail',true)='yes' THEN RAISE EXCEPTION 'resync failed'; END IF; RETURN 1; END; $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    INSERT INTO accounts VALUES ('${uid(10)}',true);
    INSERT INTO credits(id,profile_id,account_id,schedule_hash) VALUES ('${uid(20)}','${uid(1)}','${uid(10)}','old');
    INSERT INTO credit_members VALUES ('${uid(20)}','${uid(2)}','write'),('${uid(20)}','${uid(3)}','read');
    INSERT INTO transactions VALUES ('${uid(30)}',null),('${uid(31)}','${uid(30)}');
  `);
  const migration = readFileSync(require('path').join(__dirname, '../supabase/migrations/200-299/224_pilotage_reliable_sync.sql'), 'utf8');
  await db.exec(migration);
  // Migration is repeatable; existing history is marked before its parent disappears.
  await db.exec(migration);
  await db.exec(`DELETE FROM transactions WHERE id='${uid(30)}';`);
  const occurrence = (await db.query(`SELECT * FROM transactions WHERE id='${uid(31)}'`)).rows[0];
  assert.equal(occurrence.materialized_from, null); assert.equal(occurrence.is_recurring_occurrence, true);
  // Exercise the real materializer: first, intermediate and final due dates.
  await db.exec(`
    ALTER TABLE transactions ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE transactions ADD COLUMN profile_id uuid, ADD COLUMN account_id uuid,
      ADD COLUMN category_id uuid, ADD COLUMN project_id uuid, ADD COLUMN linked_account_id uuid,
      ADD COLUMN amount numeric, ADD COLUMN date date, ADD COLUMN note text,
      ADD COLUMN is_forecast boolean, ADD COLUMN is_reconciled boolean, ADD COLUMN is_draft boolean,
      ADD COLUMN is_recurring boolean, ADD COLUMN recurrence_rule text, ADD COLUMN recurrence_end_date date,
      ADD COLUMN regul_covered boolean, ADD COLUMN regul_target numeric, ADD COLUMN posted boolean;
    CREATE TABLE transaction_month_overrides(transaction_id uuid, profile_id uuid, year int, month int,
      override_amount numeric, override_note text, override_category_id uuid, override_account_id uuid);
    CREATE FUNCTION is_regul_tx(uuid,text,numeric) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION recompute_account_balance(uuid,date) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  `);
  const source = readFileSync(require('path').join(__dirname, '../supabase/migrations/100-199/175_regul_category.sql'), 'utf8');
  const start = source.indexOf('CREATE OR REPLACE FUNCTION materialize_due_recurring(');
  await db.exec(source.slice(start, source.indexOf('$$;', source.indexOf('AS $$', start)) + 3));
  for (const [index, rule, dates] of [
    [50, 'monthly', ['2026-07-24', '2026-08-24', '2026-09-24']],
    [60, 'weekly', ['2026-09-03', '2026-09-10', '2026-09-17']],
  ]) {
    await db.query(`INSERT INTO transactions(id,profile_id,account_id,amount,date,is_recurring,recurrence_rule,recurrence_end_date)
      VALUES ($1,$2,$3,-130,$4,true,$5,$6)`, [uid(index),uid(1),uid(10),dates[0],rule,dates[2]]);
    for (let step = 0; step < dates.length; step++) {
      await db.query('SELECT materialize_due_recurring($1,$2)', [uid(1),dates[step]]);
      const past = (await db.query('SELECT * FROM transactions WHERE profile_id=$1 AND date=$2 AND NOT is_recurring', [uid(1),dates[step]])).rows;
      assert.equal(past.length,1);
      assert.equal(past[0].is_recurring_occurrence,true);
      if (step < 2) {
        assert.equal(past[0].materialized_from,uid(index));
        assert.equal((await db.query('SELECT is_recurring FROM transactions WHERE id=$1',[uid(index)])).rows[0].is_recurring,true);
      }
    }
    assert.equal((await db.query('SELECT * FROM transactions WHERE id=$1',[uid(index)])).rows.length,0);
    const history = (await db.query('SELECT * FROM transactions WHERE profile_id=$1 AND date=ANY($2::date[])',[uid(1),dates])).rows;
    assert.equal(history.length,3);
    assert.ok(history.every(t => t.is_recurring_occurrence && !t.materialized_from));
    await db.query('SELECT materialize_due_recurring($1,$2)',[uid(1),dates[2]]);
    assert.equal((await db.query('SELECT * FROM transactions WHERE profile_id=$1 AND date=ANY($2::date[])',[uid(1),dates])).rows.length,3);
  }
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid','${uid(1)}',false);`);
  const rows = [{ kind: 'pay', period: 1, date: '2026-09-01', amount: -100, account_id: uid(10), category_id: null, note: 'Test' }];
  const publish = (hash, previous, revision = 0, schedule = rows) => db.query(
    'SELECT publish_credit_schedule($1,$2,$3::jsonb,current_date,$4,$5,$6)',
    [uid(20), hash, JSON.stringify(schedule), '2026-01-01', previous, revision]);
  await publish('owner','old');
  await db.exec(`SELECT set_config('test.uid','${uid(2)}',false);`);
  await publish('writer','owner');
  await db.exec(`SELECT set_config('test.uid','${uid(3)}',false);`);
  await assert.rejects(publish('reader','writer'));
  await db.exec(`SELECT set_config('test.uid','${uid(4)}',false);`);
  await assert.rejects(publish('outsider','writer'));
  await db.exec(`SELECT set_config('test.uid','${uid(1)}',false); SELECT set_config('test.resync_fail','yes',false);`);
  await assert.rejects(publish('bad','writer',0,[{ ...rows[0], amount: -999 }]));
  assert.equal((await db.query('SELECT amount FROM credit_schedule')).rows[0].amount, '-100');
  assert.equal((await db.query('SELECT schedule_hash FROM credits')).rows[0].schedule_hash, 'writer');
  await db.exec(`SELECT set_config('test.resync_fail','no',false);`);
  await assert.rejects(publish('invalid','writer',0,[{ ...rows[0], account_id: uid(11) }]));
  await db.exec(`INSERT INTO credit_events VALUES ('${uid(40)}','${uid(20)}',20);`);
  assert.equal(Number((await db.query('SELECT events_revision FROM credits')).rows[0].events_revision), 1);
  await assert.rejects(publish('stale','writer',0));
  await publish('fresh','writer',1);
  await db.exec(`DELETE FROM credit_events WHERE id='${uid(40)}';`);
  assert.equal(Number((await db.query('SELECT events_revision FROM credits')).rows[0].events_revision), 2);
  await assert.rejects(publish('stale-delete','fresh',1));
  await db.exec('SET ROLE anon;');
  await assert.rejects(publish('anonymous','fresh',2));
  console.log('PASS PostgreSQL: migration repeatability, recurring history, owner/write/read/outsider/anon permissions, rollback, account validation, event revision insert/delete.');
  await db.close();
})().catch(async error => { console.error(error); await db.close(); process.exitCode = 1; });
