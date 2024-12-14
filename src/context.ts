import * as core from "@actions/core";
import * as github from "@actions/github";
import { z } from "zod";
import { Repo } from "./repo_utils.js";
import { sleep } from "./sleep.js";

export type Context = Awaited<ReturnType<typeof createContext>>;
export type OwnerContext = Context["owners"][number];
type OwnerStatus = "SUCCESS" | "FAILURE" | "SKIPPED";

const ownersSchema = z.array(
  z.object({
    login: z.string(),
    installId: z.coerce.number(),
    fineGrainedPat: z.string(),
    skip: z.optional(z.coerce.boolean()),
  }),
);

const classicPatTokensSchema = z.array(z.string());

export function createContext() {
  const globalLogger = createLogger({
    logPrefix: "",
  });

  const classicPatTokens = classicPatTokensSchema.parse(
    JSON.parse(core.getInput("classic-pats")),
  );

  const sleepMs = parseInt(core.getInput("sleep-between-reqs-ms") || "0");

  const status: Record<string, OwnerStatus> = {};
  const printSummary = () => {
    const keys = Object.keys(status).sort();
    globalLogger.info(`Summary`);
    globalLogger.info(`------------------------------`);
    for (const key of keys) {
      globalLogger.info(`${key}: ${status[key].toLowerCase()}`);
    }
  };
  const hasFailure = () => Object.values(status).some((v) => !v);

  const owners = ownersSchema
    .parse(JSON.parse(core.getInput("owners")))
    .map((owner) => {
      const ownerLogger = createLogger({
        logPrefix: `[${owner.login}]  `,
      });

      const fineGrainedPat = createRoundRobinOctokit({
        tokens: [owner.fineGrainedPat],
        sleepBetweenRequestsMs: sleepMs,
        logger: ownerLogger,
      });
      const classicPat = createRoundRobinOctokit({
        tokens: classicPatTokens,
        sleepBetweenRequestsMs: sleepMs,
        logger: ownerLogger,
      });

      status[owner.login] = "SUCCESS";

      return {
        ...owner,
        github: {
          classicPat,
          fineGrainedPat,
        },
        log: ownerLogger,
        setStatus: (result: OwnerStatus) => (status[owner.login] = result),
      };
    });

  return {
    owners,
    status: {
      printSummary,
      hasFailure,
    },
  };
}

type Logger = ReturnType<typeof createLogger>;

function createLogger({ logPrefix }: { logPrefix: string }) {
  const debug = (msg: string) => core.debug(logPrefix + msg);
  const info = (msg: string) => core.info(logPrefix + msg);
  const repos = (repos: Repo[]) =>
    repos
      .map((r) => r.fullName)
      .sort()
      .forEach((r) => info("  " + r));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const error = (msg: string, err: any) => {
    core.error(logPrefix + msg);
    core.error(logPrefix + err);
  };
  return {
    debug,
    info,
    repos,
    error,
    extendPrefix: (addedStr: string) =>
      createLogger({
        logPrefix: logPrefix + addedStr,
      }),
  };
}

function createRoundRobinOctokit({
  tokens,
  logger,
  sleepBetweenRequestsMs,
}: {
  tokens: string[];
  logger: Logger;
  sleepBetweenRequestsMs: number;
}) {
  let i = 0;
  return () => {
    i = (i + 1) % tokens.length;

    let octokit = github.getOctokit(tokens[i]);

    if (sleepBetweenRequestsMs > 0) {
      octokit = sleepAfterRequests({
        octokit,
        sleepMs: sleepBetweenRequestsMs,
        logger,
      });
    }

    return attachRateLimitLogger({
      octokit,
      logger:
        tokens.length > 1
          ? logger.extendPrefix(` [token ${i + 1}/${tokens.length}]`)
          : logger,
    });
  };
}

function sleepAfterRequests({
  octokit,
  sleepMs,
  logger,
}: {
  octokit: ReturnType<typeof github.getOctokit>;
  sleepMs: number;
  logger: Logger;
}) {
  octokit.hook.after("request", async (response, options) => {
    logger.debug(`Sleeping for ${sleepMs}ms per config...`);
    await sleep({ milliseconds: sleepMs });
  });
  return octokit;
}

function attachRateLimitLogger({
  octokit,
  logger,
}: {
  octokit: ReturnType<typeof github.getOctokit>;
  logger: Logger;
}) {
  octokit.hook.after("request", (response, options) => {
    logger.debug(options.url);
    logger.debug(
      `x-ratelimit-remaining: ${response.headers["x-ratelimit-remaining"]}`,
    );
    logger.debug(`x-ratelimit-limit: ${response.headers["x-ratelimit-limit"]}`);

    const reset = parseFloat(response.headers["x-ratelimit-reset"] || "");
    if (!isNaN(reset)) {
      // https://stackoverflow.com/questions/4631928/convert-utc-epoch-to-local-date
      logger.debug(
        `x-ratelimit-reset: ${new Date(reset * 1000).toLocaleString()}`,
      );
    }
  });
  return octokit;
}
