type StoredConnection = {
  accessToken: string;
  expiresAt: number;
};

type FeedbackWindowGlobal = typeof globalThis & {
  feedbackWindowConnections?: Map<string, StoredConnection>;
};

const codePrefix = "FW";
const defaultTtlMs = 60 * 60 * 1000;

const getConnectionMap = () => {
  const sharedGlobal = globalThis as FeedbackWindowGlobal;

  if (!sharedGlobal.feedbackWindowConnections) {
    sharedGlobal.feedbackWindowConnections = new Map<string, StoredConnection>();
  }

  return sharedGlobal.feedbackWindowConnections;
};

export const normalizeConnectionCode = (code: string) => {
  return code.trim().toUpperCase();
};

export const createConnectionCode = () => {
  const connections = getConnectionMap();
  let connectionCode = "";

  do {
    connectionCode = `${codePrefix}-${Math.floor(100000 + Math.random() * 900000)}`;
  } while (connections.has(connectionCode));

  return connectionCode;
};

export const saveConnectionToken = (
  connectionCode: string,
  accessToken: string,
  ttlSeconds?: number
) => {
  const ttlMs = Math.max(60, ttlSeconds || defaultTtlMs / 1000) * 1000;

  getConnectionMap().set(normalizeConnectionCode(connectionCode), {
    accessToken,
    expiresAt: Date.now() + ttlMs
  });
};

export const getConnectionToken = (connectionCode: string) => {
  const normalizedCode = normalizeConnectionCode(connectionCode);
  const connection = getConnectionMap().get(normalizedCode);

  if (!connection) {
    return "";
  }

  if (connection.expiresAt <= Date.now()) {
    getConnectionMap().delete(normalizedCode);
    return "";
  }

  return connection.accessToken;
};

export const hasConnectionToken = (connectionCode: string) => {
  return Boolean(getConnectionToken(connectionCode));
};
