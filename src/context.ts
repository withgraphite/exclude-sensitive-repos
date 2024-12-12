import * as core from "@actions/core";
import * as github from "@actions/github";
import { z } from "zod";
import { Repo } from "./repo_utils.js";

export type Context = Awaited<ReturnType<typeof createContext>>;
export type OwnerContext = Context["owners"][number];
type OwnerStatus = "SUCCESS" | "FAILURE" | "SKIPPED";

const ownersSchema = z.array(
  z.object({
    login: z.string(),
    installId: z.coerce.number(),
    fineGrainedPat: z.string(),
    skip: z.optional(z.coerce.boolean()),
  })
);

export function createContext() {
  const globalLogger = createLogger({
    logPrefix: "",
  });

  const classicPat = github.getOctokit(core.getInput("classic-pat"));

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
    .parse(JSON.parse(core.getInput("OWNERS")))
    .map((owner) => {
      const ownerLogger = createLogger({
        logPrefix: `[${owner.login}]  `,
      });
      const attachRateLimitLogger = (
        octokit: ReturnType<typeof github.getOctokit>
      ) => {
        octokit.hook.after("request", (response, options) => {
          ownerLogger.debug(options.url);
          ownerLogger.debug(
            `x-ratelimit-remaining: ${response.headers["x-ratelimit-remaining"]}`
          );
          ownerLogger.debug(
            `x-ratelimit-limit: ${response.headers["x-ratelimit-limit"]}`
          );

          const reset = parseFloat(response.headers["x-ratelimit-reset"] || "");
          if (!isNaN(reset)) {
            // https://stackoverflow.com/questions/4631928/convert-utc-epoch-to-local-date
            ownerLogger.debug(
              `x-ratelimit-reset: ${new Date(reset * 1000).toLocaleString()}`
            );
          }
        });
        return octokit;
      };

      const fineGrainedPat = github.getOctokit(owner.fineGrainedPat);

      return {
        ...owner,
        github: {
          classicPat: attachRateLimitLogger(classicPat),
          fineGrainedPat: attachRateLimitLogger(fineGrainedPat),
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
  };
}
