import * as core from "@actions/core";
import { createContext, OwnerContext } from "./context.js";
import { Repo, sortRepos } from "./repo_utils.js";

export async function run(): Promise<void> {
  try {
    const context = createContext();

    for (const owner of context.owners) {
      // These are intentionally serial to avoid secondary rate limits
      await runOnOwner(owner);
    }

    context.status.printSummary();
    if (context.status.hasFailure()) {
      core.setFailed(`Action failed; check logs for details`);
    }
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message);
    }
  }
}

async function runOnOwner(context: OwnerContext) {
  if (context.skip) {
    context.log.info(`Skipping ${context.login} as requested...`);
    context.log.info(``);
    context.setStatus("SKIPPED");
    return;
  }

  try {
    const { sensitiveRepos } = await fetchOrgRepos(context);
    await updateInstalledRepos({
      removeRepos: sensitiveRepos,
      context,
    });
  } catch (err) {
    context.log.error(`Failed to run on ${context.login}`, err);
    context.setStatus("FAILURE");
  }
}

async function fetchOrgRepos(context: OwnerContext): Promise<{
  sensitiveRepos: Repo[];
}> {
  const repoInfo: Record<
    string,
    {
      id: number;
      fullName: string;
      properties: Record<string, string | string[] | null>;
    }
  > = {};

  for await (const response of context.github
    .fineGrainedPat()
    .paginate.iterator(
      context.github.fineGrainedPat().rest.orgs
        .listCustomPropertiesValuesForRepos,
      {
        org: context.login,
        repository_query: "archived:false",
      },
    )) {
    response.data.forEach((repo) => {
      const properties = repo.properties.reduce(
        (acc, { property_name, value }) => {
          acc[property_name] = value;
          return acc;
        },
        {} as Record<string, string | string[] | null>,
      );

      repoInfo[repo.repository_id] = {
        id: repo.repository_id,
        fullName: repo.repository_full_name,
        properties,
      };
    });
  }

  const sensitiveRepos = Object.values(repoInfo)
    .filter((repo) => repo.properties["sensitive"] == "true")
    .sort(sortRepos);

  const sensitiveReposSet = new Set();
  sensitiveRepos.forEach((sr) => sensitiveReposSet.add(sr.id));

  context.log.info(`All '${context.login}' repos (visible to supplied token)`);
  context.log.info("------------------------------");
  context.log.info("");

  context.log.info(`Sensitive [${sensitiveRepos.length}]:`);
  context.log.repos(sensitiveRepos);
  context.log.info("");

  return {
    sensitiveRepos,
  };
}

async function updateInstalledRepos({
  removeRepos,
  context,
}: {
  removeRepos: Repo[];
  context: OwnerContext;
}) {
  if (removeRepos.length === 0) {
    context.log.info(`No repo adjustments needed!`);
    context.log.info(``);
    return;
  }

  context.log.info(`Applying adjustments...`);
  context.log.info(``);

  for (const repo of removeRepos) {
    try {
      const res = await context.github
        .classicPat()
        .rest.apps.removeRepoFromInstallationForAuthenticatedUser({
          installation_id: context.installId,
          repository_id: repo.id,
        });
      context.log.info(`- ${repo.fullName} (status: ${res.status})`);
    } catch (err) {
      context.log.error(
        `Failed to remove ${repo.fullName} (id: ${repo.id})`,
        err,
      );
      context.setStatus("FAILURE");
    }
  }
  context.log.info(``);
}
