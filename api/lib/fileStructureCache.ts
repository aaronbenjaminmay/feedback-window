import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Page structure (which pages exist, which top-level frames belong to them)
// changes far less often than comments do, and reviewers reopen the same
// file repeatedly during a review cycle — caching this lets every open
// after the first skip Figma's file endpoint entirely, which can take many
// seconds on large/complex files even for a small, depth-limited response.
const FILE_STRUCTURE_TTL_SECONDS = 600;

type CachedFileStructure = {
  nodePageMap: Record<string, string>;
  pageNames: string[];
};

const buildKey = (fileKey: string) => `file-structure:${fileKey}`;

export const getCachedFileStructure = async (fileKey: string) => {
  const cached = await redis.get<CachedFileStructure>(buildKey(fileKey));

  if (!cached) {
    return null;
  }

  return {
    nodePageMap: new Map(Object.entries(cached.nodePageMap)),
    pageNames: cached.pageNames
  };
};

export const setCachedFileStructure = async (
  fileKey: string,
  nodePageMap: Map<string, string>,
  pageNames: string[]
) => {
  await redis.set<CachedFileStructure>(
    buildKey(fileKey),
    {
      nodePageMap: Object.fromEntries(nodePageMap),
      pageNames
    },
    { ex: FILE_STRUCTURE_TTL_SECONDS }
  );
};
