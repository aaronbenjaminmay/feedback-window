import { Redis } from "@upstash/redis";

type StoredConnection = {
  accessToken: string;
};

const redis = Redis.fromEnv();
const codePrefix = "FW";
const codeTtlSeconds = 600;
const sessionTtlSeconds = 14400;

const buildCodeKey = (connectionCode: string) => {
  return `code:${normalizeConnectionCode(connectionCode)}`;
};

const buildSessionKey = (connectionId: string) => {
  return `session:${normalizeConnectionCode(connectionId)}`;
};

const createRandomDigits = () => {
  return Math.floor(100000 + Math.random() * 900000);
};

export const normalizeConnectionCode = (code: string) => {
  return code.trim().toUpperCase();
};

export const createConnectionCode = () => {
  return `${codePrefix}-${createRandomDigits()}`;
};

export const createConnectionId = () => {
  return `${codePrefix}-SESSION-${createRandomDigits()}-${createRandomDigits()}`;
};

export const saveConnectionCode = async (
  connectionCode: string,
  accessToken: string
) => {
  await redis.set<StoredConnection>(
    buildCodeKey(connectionCode),
    { accessToken },
    { ex: codeTtlSeconds }
  );
};

export const claimConnectionCode = async (connectionCode: string) => {
  const normalizedCode = normalizeConnectionCode(connectionCode);
  const codeKey = buildCodeKey(normalizedCode);
  const storedConnection = await redis.get<StoredConnection>(codeKey);

  if (!storedConnection?.accessToken) {
    return "";
  }

  const connectionId = createConnectionId();

  await redis.set<StoredConnection>(
    buildSessionKey(connectionId),
    { accessToken: storedConnection.accessToken },
    { ex: sessionTtlSeconds }
  );
  await redis.del(codeKey);

  return connectionId;
};

export const getSessionToken = async (connectionId: string) => {
  const normalizedConnectionId = normalizeConnectionCode(connectionId);

  if (!normalizedConnectionId) {
    return "";
  }

  const storedConnection = await redis.get<StoredConnection>(
    buildSessionKey(normalizedConnectionId)
  );

  return storedConnection?.accessToken || "";
};

export const hasSessionToken = async (connectionId: string) => {
  return Boolean(await getSessionToken(connectionId));
};
