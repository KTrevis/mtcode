import * as Schema from "effect/Schema";

// A closed record emits the top-level object type required by MCP; an empty Struct can emit anyOf.
export const EmptyToolInput = Schema.Record(Schema.String, Schema.Never);
