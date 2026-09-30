import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("072_ProjectKanbanCards", (it) => {
  it.effect("gives existing projects an empty board", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 63 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES (
          'existing-project', 'Existing project', '/tmp/existing-project', '[]',
          '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 64 });
      const rows = yield* sql<{ readonly kanbanCards: string }>`
        SELECT kanban_cards_json AS "kanbanCards"
        FROM projection_projects WHERE project_id = 'existing-project'
      `;
      assert.strictEqual(rows[0]?.kanbanCards, "[]");
    }),
  );
});
