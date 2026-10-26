import { assert, describe, it } from "@effect/vitest";
import { ApplicationProjectCreatedPayload } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";

import { FIRST_V2_MIGRATION_ID, migrationManifest, runMigrations } from "./Migrations.ts";

const decodeProjectBaseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(ApplicationProjectCreatedPayload),
);

const v2Migrations = migrationManifest.filter(([id]) => id >= FIRST_V2_MIGRATION_ID);
const newerMigrationId = Math.max(...migrationManifest.map(([id]) => id)) + 1;

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const v2TableCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return rows.length;
});

describe("runMigrations", () => {
  it.effect("refuses to start when another migration took a V2 id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID - 1 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${FIRST_V2_MIGRATION_ID}, 'FutureMainMigration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(
        yield* runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID - 1 }),
        [],
      );
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(
        String(exit),
        `${FIRST_V2_MIGRATION_ID}_OrchestrationV2 (recorded: FutureMainMigration)`,
      );
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when a later id would skip V2 migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID - 1 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'FutureMainMigration')
      `;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      for (const [id, name] of v2Migrations) {
        assert.include(String(exit), `${id}_${name} (recorded: nothing)`);
      }
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades the fork database while preserving its migration history", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID - 1 });
      const sql = yield* SqlClient.SqlClient;
      const cards = JSON.stringify([
        { id: "ticket", title: "Keep work", column: "TODO", tagIds: ["tag"] },
      ]);
      const tags = JSON.stringify([{ id: "tag", name: "Feature" }]);
      yield* sql`INSERT INTO projection_projects
        (project_id, title, workspace_root, scripts_json, created_at, updated_at, kanban_cards_json, kanban_tags_json)
        VALUES ('fork-project', 'Fork', '/tmp/fork', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ${cards}, ${tags})`;
      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      const rows = yield* sql<{ readonly cards: string; readonly tags: string }>`
        SELECT kanban_cards_json AS cards, kanban_tags_json AS tags
        FROM projection_projects WHERE project_id = 'fork-project'
      `;
      assert.deepStrictEqual(rows, [{ cards, tags }]);
      const baseline = yield* sql<{ readonly payload: string }>`
        SELECT payload_json AS payload FROM orchestration_events
        WHERE stream_id = 'fork-project' AND application_event_version = 2
          AND event_type = 'project.created'
      `;
      const payload = decodeProjectBaseline(baseline[0]!.payload);
      assert.deepStrictEqual(payload.kanbanCards, JSON.parse(cards));
      assert.deepStrictEqual(payload.kanbanTags, JSON.parse(tags));
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([30, FIRST_V2_MIGRATION_ID - 1])(
    "still starts with a site-local migration at id %s",
    (id) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID - 1 });
        yield* sql`
        UPDATE effect_sql_migrations SET name = 'SiteLocalMigration' WHERE migration_id = ${id}
      `;

        assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
        assert.isAbove(yield* v2TableCount, 0);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("only checks V2 migrations within the requested limit", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${FIRST_V2_MIGRATION_ID + 1}, 'SiteLocalMigration'), (${newerMigrationId}, 'NewerV2Migration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(
        yield* runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID }),
        [],
      );
      const exit = yield* Effect.exit(
        runMigrations({ toMigrationInclusive: FIRST_V2_MIGRATION_ID + 1 }),
      );
      assert.isTrue(Exit.isFailure(exit));
      assert.include(
        String(exit),
        `${FIRST_V2_MIGRATION_ID + 1}_RemoveRedundantProjectionIndexes (recorded: SiteLocalMigration)`,
      );
      assert.notInclude(String(exit), `${FIRST_V2_MIGRATION_ID + 2}_ScheduledTaskWebhooks`);
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("still starts after a newer build recorded a later V2 migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'NewerV2Migration')
      `;

      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
