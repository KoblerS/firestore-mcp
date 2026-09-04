# Firebase MCP Server – Implementierungsplan

## Überblick
Ein **command-basierter** (stdio) MCP Server in TypeScript, der Google Firebase (Auth + Firestore) über das Model Context Protocol bereitstellt. Credentials werden **dynamisch** aus `.firebase/service-account.json` im aktuellen Projektverzeichnis geladen.

## Projektstruktur
```
firestore-mcp/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── src/
│   ├── index.ts              # Entry-Point: MCP Server Setup + stdio Transport
│   ├── firebase.ts           # Firebase Admin SDK Init (dynamisches Credential Loading)
│   ├── tools/
│   │   ├── auth.ts           # Auth-Tools (list users, get user, create, update, delete, disable)
│   │   └── firestore.ts      # Firestore-Tools (list collections, get doc, query, set, update, delete, list docs)
│   └── utils.ts              # Hilfsfunktionen (Pfade, Error-Handling)
```

## Credential-Loading Strategie
1. Suche `.firebase/service-account.json` im CWD (wo der MCP Server gestartet wird)
2. Falls nicht gefunden: Suche aufwärts in Parent-Dirs (wie `.git`-Suche)
3. Falls nicht gefunden: Prüfe `GOOGLE_APPLICATION_CREDENTIALS` Env-Var
4. Falls nichts gefunden: Klarer Fehler mit Anleitung

## MCP Tools (insgesamt ~14 Tools)

### 🔐 Auth Tools
| Tool | Beschreibung |
|------|-------------|
| `firebase_auth_get_user` | User per UID oder Email abrufen |
| `firebase_auth_list_users` | Users auflisten (paginiert, max 1000) |
| `firebase_auth_create_user` | Neuen User anlegen |
| `firebase_auth_update_user` | User updaten (email, password, displayName, disabled, etc.) |
| `firebase_auth_delete_user` | User löschen |
| `firebase_auth_set_custom_claims` | Custom Claims setzen |

### 📄 Firestore Tools
| Tool | Beschreibung |
|------|-------------|
| `firestore_list_collections` | Top-Level oder Sub-Collections eines Docs auflisten |
| `firestore_get_document` | Einzelnes Dokument per Pfad holen |
| `firestore_list_documents` | Alle Docs einer Collection auflisten (paginiert) |
| `firestore_query_documents` | Collection mit where/orderBy/limit abfragen |
| `firestore_set_document` | Dokument setzen (merge optional) |
| `firestore_update_document` | Dokument-Felder updaten |
| `firestore_delete_document` | Dokument löschen |
| `firestore_count_documents` | Dokumente in einer Collection zählen |

## Tech Stack
- **TypeScript** mit ES Modules
- **@modelcontextprotocol/sdk** `^1.30.0` – MCP Server + stdio Transport
- **firebase-admin** `^14.3.0` – Firebase Admin SDK
- **zod** – Schema Validation (kommt mit MCP SDK)
- Build: `tsc` → `dist/`, ausführbar via `node dist/index.js`

## MCP Config (für Claude Desktop / Cursor / etc.)
```json
{
  "mcpServers": {
    "firebase": {
      "command": "node",
      "args": ["/path/to/firestore-mcp/dist/index.js"],
      "cwd": "/path/to/your-project"  // ← hier wird .firebase/service-account.json gesucht
    }
  }
}
```

## Implementierungsschritte
1. `package.json` + `tsconfig.json` + `.gitignore` erstellen
2. `src/firebase.ts` – Dynamisches Credential Loading
3. `src/utils.ts` – Helpers
4. `src/tools/auth.ts` – Alle Auth-Tools registrieren
5. `src/tools/firestore.ts` – Alle Firestore-Tools registrieren
6. `src/index.ts` – Server zusammenbauen + starten
7. `README.md` mit Setup-Anleitung
8. Build testen
