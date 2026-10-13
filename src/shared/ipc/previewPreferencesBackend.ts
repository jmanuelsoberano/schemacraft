/**
 * Simulated preferences for development in a plain browser: a seeded history kept in memory
 * for the lifetime of the page. Loaded only in development builds outside the desktop runtime.
 */
import type { Preferences, SavedConnection } from "@/shared/contracts";

import type { PreferencesBackend } from "./preferencesBackend";

const RECENT_CONNECTIONS_LIMIT = 10;
const RECENT_PROJECTS_LIMIT = 10;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

let preferences: Preferences = {
  formatVersion: 1,
  recentConnections: [
    {
      connection: {
        provider: "sqlServer",
        host: "localhost",
        instance: "SQLEXPRESS",
        port: null,
        database: "Northwind",
        authentication: { mode: "integrated" },
        encryption: "mandatory",
        trustServerCertificate: true,
      },
      lastUsedAt: minutesAgo(40),
    },
    {
      connection: {
        provider: "sqlServer",
        host: "db.example.com",
        instance: null,
        port: 1433,
        database: "AdventureWorks2022",
        authentication: { mode: "sqlLogin", username: "reporting" },
        encryption: "mandatory",
        trustServerCertificate: false,
      },
      lastUsedAt: minutesAgo(3 * 24 * 60),
    },
  ],
  recentProjects: [
    { path: "C:\\Projects\\northwind.scraft", lastOpenedAt: minutesAgo(40) },
    { path: "C:\\Projects\\adventureworks.scraft", lastOpenedAt: minutesAgo(5 * 24 * 60) },
  ],
};

function sameEndpoint(left: SavedConnection, right: SavedConnection): boolean {
  const key = (connection: SavedConnection) =>
    [
      connection.host,
      connection.instance ?? "",
      connection.port ?? "",
      connection.database ?? "",
      connection.authentication.mode === "sqlLogin"
        ? connection.authentication.username
        : "<windows>",
    ]
      .join("|")
      .toLowerCase();
  return key(left) === key(right);
}

function snapshot(): Promise<Preferences> {
  return Promise.resolve(structuredClone(preferences));
}

export const previewPreferencesBackend: PreferencesBackend = {
  readPreferences: snapshot,

  rememberConnection(connection) {
    preferences = {
      ...preferences,
      recentConnections: [
        { connection, lastUsedAt: new Date().toISOString() },
        ...preferences.recentConnections.filter(
          (entry) => !sameEndpoint(entry.connection, connection),
        ),
      ].slice(0, RECENT_CONNECTIONS_LIMIT),
    };
    return snapshot();
  },

  forgetConnection(connection) {
    preferences = {
      ...preferences,
      recentConnections: preferences.recentConnections.filter(
        (entry) => !sameEndpoint(entry.connection, connection),
      ),
    };
    return snapshot();
  },

  rememberProject(path) {
    preferences = {
      ...preferences,
      recentProjects: [
        { path, lastOpenedAt: new Date().toISOString() },
        ...preferences.recentProjects.filter((entry) => entry.path !== path),
      ].slice(0, RECENT_PROJECTS_LIMIT),
    };
    return snapshot();
  },

  forgetProject(path) {
    preferences = {
      ...preferences,
      recentProjects: preferences.recentProjects.filter((entry) => entry.path !== path),
    };
    return snapshot();
  },
};
