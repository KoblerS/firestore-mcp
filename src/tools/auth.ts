import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAuthInstance } from "../firebase.js";
import { formatError, truncateResult } from "../utils.js";

export function registerAuthTools(server: McpServer): void {
  // ─── Get User ───────────────────────────────────────────────
  server.registerTool(
    "firebase_auth_get_user",
    {
      description: "Get a Firebase Auth user by UID or email",
      inputSchema: {
        uid: z.string().optional().describe("User UID"),
        email: z.string().email().optional().describe("User email"),
      },
    },
    async ({ uid, email }) => {
      try {
        if (!uid && !email) {
          return { content: [{ type: "text", text: "Error: Provide either 'uid' or 'email'" }] };
        }

        const auth = getAuthInstance();
        const user = uid
          ? await auth.getUser(uid)
          : await auth.getUserByEmail(email!);

        return {
          content: [{
            type: "text",
            text: truncateResult({
              uid: user.uid,
              email: user.email,
              emailVerified: user.emailVerified,
              displayName: user.displayName,
              photoURL: user.photoURL,
              phoneNumber: user.phoneNumber,
              disabled: user.disabled,
              metadata: {
                creationTime: user.metadata.creationTime,
                lastSignInTime: user.metadata.lastSignInTime,
                lastRefreshTime: user.metadata.lastRefreshTime,
              },
              customClaims: user.customClaims,
              providerData: user.providerData,
              tokensValidAfterTime: user.tokensValidAfterTime,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── List Users ─────────────────────────────────────────────
  server.registerTool(
    "firebase_auth_list_users",
    {
      description: "List Firebase Auth users (paginated, max 1000 per page)",
      inputSchema: {
        maxResults: z.number().min(1).max(1000).default(100).describe("Max users to return (1-1000)"),
        pageToken: z.string().optional().describe("Page token for pagination"),
      },
    },
    async ({ maxResults, pageToken }) => {
      try {
        const auth = getAuthInstance();
        const result = await auth.listUsers(maxResults, pageToken);

        const users = result.users.map((user) => ({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          disabled: user.disabled,
          emailVerified: user.emailVerified,
          creationTime: user.metadata.creationTime,
          lastSignInTime: user.metadata.lastSignInTime,
        }));

        return {
          content: [{
            type: "text",
            text: truncateResult({
              users,
              totalReturned: users.length,
              pageToken: result.pageToken ?? null,
              hasMore: !!result.pageToken,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Create User ────────────────────────────────────────────
  server.registerTool(
    "firebase_auth_create_user",
    {
      description: "Create a new Firebase Auth user",
      inputSchema: {
        email: z.string().email().optional().describe("User email"),
        password: z.string().min(6).optional().describe("User password (min 6 chars)"),
        displayName: z.string().optional().describe("Display name"),
        phoneNumber: z.string().optional().describe("Phone number (E.164 format, e.g. +1234567890)"),
        photoURL: z.string().url().optional().describe("Photo URL"),
        emailVerified: z.boolean().optional().describe("Set email as verified"),
        disabled: z.boolean().optional().describe("Create as disabled"),
      },
      annotations: {
        destructiveHint: false,
      },
    },
    async (params) => {
      try {
        const auth = getAuthInstance();

        const createRequest: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) createRequest[key] = value;
        }

        const user = await auth.createUser(createRequest);

        return {
          content: [{
            type: "text",
            text: truncateResult({
              message: "User created successfully",
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Update User ────────────────────────────────────────────
  server.registerTool(
    "firebase_auth_update_user",
    {
      description: "Update a Firebase Auth user",
      inputSchema: {
        uid: z.string().describe("User UID to update"),
        email: z.string().email().optional().describe("New email"),
        password: z.string().min(6).optional().describe("New password (min 6 chars)"),
        displayName: z.string().optional().describe("New display name (empty string to clear)"),
        phoneNumber: z.string().optional().describe("New phone number (empty string to clear)"),
        photoURL: z.string().optional().describe("New photo URL (empty string to clear)"),
        emailVerified: z.boolean().optional().describe("Set email verified status"),
        disabled: z.boolean().optional().describe("Disable or enable user"),
      },
    },
    async ({ uid, ...updates }) => {
      try {
        const auth = getAuthInstance();

        const updateRequest: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) updateRequest[key] = value;
        }

        const user = await auth.updateUser(uid, updateRequest);

        return {
          content: [{
            type: "text",
            text: truncateResult({
              message: "User updated successfully",
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              disabled: user.disabled,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Delete User ────────────────────────────────────────────
  server.registerTool(
    "firebase_auth_delete_user",
    {
      description: "Delete a Firebase Auth user by UID",
      inputSchema: {
        uid: z.string().describe("User UID to delete"),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ uid }) => {
      try {
        const auth = getAuthInstance();
        await auth.deleteUser(uid);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ message: `User ${uid} deleted successfully` }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );

  // ─── Set Custom Claims ──────────────────────────────────────
  server.registerTool(
    "firebase_auth_set_custom_claims",
    {
      description: "Set custom claims on a Firebase Auth user (e.g. admin roles). Claims are included in the user's ID token.",
      inputSchema: {
        uid: z.string().describe("User UID"),
        claims: z
          .record(z.unknown())
          .describe('Custom claims object (e.g. {"admin": true, "role": "editor"}). Pass {} to clear all claims.'),
      },
    },
    async ({ uid, claims }) => {
      try {
        const auth = getAuthInstance();
        await auth.setCustomUserClaims(uid, claims);

        const user = await auth.getUser(uid);

        return {
          content: [{
            type: "text",
            text: truncateResult({
              message: `Custom claims set for user ${uid}`,
              uid: user.uid,
              customClaims: user.customClaims ?? {},
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: formatError(error) }], isError: true };
      }
    }
  );
}
