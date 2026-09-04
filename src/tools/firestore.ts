import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getFirestoreInstance } from "../firebase.js";
import {
  serializeFirestoreData,
  deserializeValue,
  formatError,
  truncateResult,
} from "../utils.js";

// Zod schema for Firestore where clauses
const whereClause = z.object({
  field: z.string().describe("Field path (e.g. 'name', 'address.city')"),
  op: z.enum([
    "==", "!=", "<", "<=", ">", ">=",
    "array-contains", "array-contains-any",
    "in", "not-in",
  ]).describe("Comparison operator"),
  value: z.unknown().describe("Value to compare against"),
});

const orderByClause = z.object({
  field: z.string().describe("Field path to order by"),
  direction: z.enum(["asc", "desc"]).default("asc").describe("Sort direction"),
});

export function registerFirestoreTools(server: McpServer): void {
  // ─── List Collections ───────────────────────────────────────
  server.registerTool(
    "firestore_list_collections",
    {
      description: "List top-level collections or subcollections of a document",
      inputSchema: {
        documentPath: z
          .string()
          .optional()
          .describe("Document path to list subcollections for (e.g. 'users/uid123'). Omit for top-level collections."),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ documentPath }) => {
      try {
        const db = getFirestoreInstance();

        const collections = documentPath
          ? await db.doc(documentPath).listCollections()
          : await db.listCollections();

        const collectionIds = collections.map((col) => ({
          id: col.id,
          path: col.path,
        }));

        return {
          content: [{
            type: "text",
            text: truncateResult({
              collections: collectionIds,
              total: collectionIds.length,
              parentDocument: documentPath ?? "(root)",
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Get Document ───────────────────────────────────────────
  server.registerTool(
    "firestore_get_document",
    {
      description: "Get a single Firestore document by its path",
      inputSchema: {
        path: z.string().describe("Full document path (e.g. 'users/uid123', 'orders/order1/items/item1')"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ path }) => {
      try {
        const db = getFirestoreInstance();
        const doc = await db.doc(path).get();

        if (!doc.exists) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ exists: false, path, message: "Document does not exist" }),
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: truncateResult({
              exists: true,
              path: doc.ref.path,
              id: doc.id,
              createTime: doc.createTime?.toDate().toISOString(),
              updateTime: doc.updateTime?.toDate().toISOString(),
              data: serializeFirestoreData(doc.data()!),
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── List Documents ─────────────────────────────────────────
  server.registerTool(
    "firestore_list_documents",
    {
      description: "List all documents in a Firestore collection (paginated)",
      inputSchema: {
        collection: z.string().describe("Collection path (e.g. 'users', 'orders/order1/items')"),
        limit: z.number().min(1).max(500).default(20).describe("Max documents to return (1-500)"),
        offset: z.number().min(0).default(0).describe("Number of documents to skip"),
        orderBy: z.string().optional().describe("Field to order by (prefix with '-' for descending, e.g. '-createdAt')"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ collection, limit, offset, orderBy }) => {
      try {
        const db = getFirestoreInstance();
        let query = db.collection(collection).offset(offset).limit(limit);

        if (orderBy) {
          const desc = orderBy.startsWith("-");
          const field = desc ? orderBy.slice(1) : orderBy;
          query = query.orderBy(field, desc ? "desc" : "asc");
        }

        const snapshot = await query.get();

        const documents = snapshot.docs.map((doc) => ({
          id: doc.id,
          path: doc.ref.path,
          data: serializeFirestoreData(doc.data()),
        }));

        return {
          content: [{
            type: "text",
            text: truncateResult({
              collection,
              documents,
              returned: documents.length,
              offset,
              limit,
              hasMore: documents.length === limit,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Query Documents ────────────────────────────────────────
  server.registerTool(
    "firestore_query_documents",
    {
      description: "Query Firestore documents with filters, ordering, and pagination",
      inputSchema: {
        collection: z.string().describe("Collection path (e.g. 'users', 'orders/order1/items')"),
        where: z.array(whereClause).optional().describe("Filter conditions"),
        orderBy: z.array(orderByClause).optional().describe("Order by fields"),
        limit: z.number().min(1).max(500).default(20).describe("Max documents to return"),
        startAfter: z.unknown().optional().describe("Cursor value to start after (for pagination with orderBy)"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ collection, where: whereClauses, orderBy: orderByClauses, limit, startAfter }) => {
      try {
        const db = getFirestoreInstance();
        let query: FirebaseFirestore.Query = db.collection(collection);

        if (whereClauses) {
          for (const clause of whereClauses) {
            query = query.where(clause.field, clause.op, clause.value);
          }
        }

        if (orderByClauses) {
          for (const order of orderByClauses) {
            query = query.orderBy(order.field, order.direction);
          }
        }

        if (startAfter !== undefined) {
          query = query.startAfter(startAfter);
        }

        query = query.limit(limit);

        const snapshot = await query.get();

        const documents = snapshot.docs.map((doc) => ({
          id: doc.id,
          path: doc.ref.path,
          data: serializeFirestoreData(doc.data()),
        }));

        let nextCursor: unknown = null;
        if (documents.length === limit && orderByClauses?.length && snapshot.docs.length > 0) {
          const lastDoc = snapshot.docs[snapshot.docs.length - 1]!;
          nextCursor = lastDoc.data()[orderByClauses[0]!.field];
        }

        return {
          content: [{
            type: "text",
            text: truncateResult({
              collection,
              documents,
              returned: documents.length,
              limit,
              nextCursor,
              hasMore: documents.length === limit,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Count Documents ────────────────────────────────────────
  server.registerTool(
    "firestore_count_documents",
    {
      description: "Count documents in a Firestore collection (with optional filters)",
      inputSchema: {
        collection: z.string().describe("Collection path"),
        where: z.array(whereClause).optional().describe("Filter conditions"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ collection, where: whereClauses }) => {
      try {
        const db = getFirestoreInstance();
        let query: FirebaseFirestore.Query = db.collection(collection);

        if (whereClauses) {
          for (const clause of whereClauses) {
            query = query.where(clause.field, clause.op, clause.value);
          }
        }

        const snapshot = await query.count().get();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              collection,
              count: snapshot.data().count,
              filters: whereClauses ?? [],
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Set Document ───────────────────────────────────────────
  server.registerTool(
    "firestore_set_document",
    {
      description: "Set (create or overwrite) a Firestore document. Use merge:true to only update specified fields.",
      inputSchema: {
        path: z.string().describe("Full document path (e.g. 'users/uid123')"),
        data: z.record(z.unknown()).describe("Document data to set"),
        merge: z.boolean().default(false).describe("If true, merge with existing document instead of overwriting"),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ path, data, merge }) => {
      try {
        const db = getFirestoreInstance();
        const deserializedData = deserializeValue(data) as Record<string, unknown>;

        await db.doc(path).set(deserializedData, { merge });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: `Document ${merge ? "merged" : "set"} successfully`,
              path,
              merge,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Update Document ────────────────────────────────────────
  server.registerTool(
    "firestore_update_document",
    {
      description: "Update specific fields on an existing Firestore document (fails if document doesn't exist). Supports special field values: {_type: 'serverTimestamp'}, {_type: 'increment', value: 5}, {_type: 'arrayUnion', elements: [...]}, {_type: 'arrayRemove', elements: [...]}, {_type: 'delete'}",
      inputSchema: {
        path: z.string().describe("Full document path (e.g. 'users/uid123')"),
        data: z.record(z.unknown()).describe("Fields to update"),
      },
    },
    async ({ path, data }) => {
      try {
        const db = getFirestoreInstance();
        const deserializedData = deserializeValue(data) as Record<string, unknown>;

        await db.doc(path).update(deserializedData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Document updated successfully",
              path,
              updatedFields: Object.keys(data),
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Delete Document ────────────────────────────────────────
  server.registerTool(
    "firestore_delete_document",
    {
      description: "Delete a Firestore document by its path",
      inputSchema: {
        path: z.string().describe("Full document path (e.g. 'users/uid123')"),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ path }) => {
      try {
        const db = getFirestoreInstance();
        await db.doc(path).delete();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Document deleted successfully",
              path,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );
}
