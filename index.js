const core = require('@actions/core');
const github = require('@actions/github');

const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const workflowAction = core.getInput('WORKFLOW_ACTION');
const triggerBranch = core.getInput('TRIGGER_BRANCH');
const baseBranch = core.getInput('BASE_BRANCH');
const octokit = github.getOctokit(GITHUB_TOKEN);

const { context = {} } = github;
const { pull_request } = context.payload;

handleFlowAction().then(r => console.log(`${workflowAction} was run!`));

async function handleFlowAction() {
  switch (workflowAction) {
    case 'prinit':
      try {
        await createCommitStatus(pull_request.head.sha, 'pending');
        await createInfoComment('Manual merging is disabled. To start merging process use the slash command */merge-it* in a new comment. That will trigger testing pipeline and merging.', pull_request.number);
      } catch (err) {
        console.log('Error received: ', err);
        await createInfoComment(err.message, pull_request.number);
        core.setFailed(err.message);
      }
      break;

    case 'merge-it':
      try {
        const pr = await getPullRequest(github.context.payload.issue.number);
        const branch = await getBranchRef(triggerBranch);
        const currentCommit = await getCurrentCommit(branch.data.object.sha);
        await triggerPipeline(pr.data, branch.data, currentCommit.data);
      } catch (err) {
        console.log('Error received: ', err);
        await createInfoComment(err.message, github.context.payload.issue.number);
        core.setFailed(err.message);
      }
      break;

    case 'merge-now':
      try {
        const pr = await getPullRequest(github.context.payload.issue.number);
        const precheck = await canBeMerged(pr.data);
        if (precheck.mergeStatus) {
          await createCommitStatus(pr.data.head.sha, 'success');
          const mergeInfo = await mergePullRequest(pr.data.head.ref, baseBranch);
          console.log(mergeInfo);
        } else {
          if (precheck.mergeProblems.length) {
            for (const problem of precheck.mergeProblems) {
              await createInfoComment(problem, github.context.payload.issue.number);
            }
          }
        }
      } catch (err) {
        console.log('Error received: ', err);
        await createInfoComment(err.message, github.context.payload.issue.number);
        core.setFailed(err.message);
      }
      break;

    case 'merge-pr':
      let prNumber;
      try {
        const prNumber = await getPRByCommit(github.context.payload.sha);
        if (prNumber === undefined) {
          core.setFailed(`Pull request associated to this commit (${github.context.payload.sha}) could not be found!`);
          break;
        }
        await mergePullRequest(github.context.payload.branches[0].name, baseBranch);
      } catch (err) {
        console.log('Error received: ', err);
        await createInfoComment(err.message, prNumber);
        core.setFailed(err.message);
      }
      break;
    default:
      core.setFailed(`Workflow action not supported!`);
  }
}

async function canBeMerged(pr) {
  let mergingInfo;
  const { mergeable_state, mergeable, number, head } = pr;
  const query = `query {
    repository(owner: "${context.repo.owner}", name: "${context.repo.repo}") {
      pullRequest(number: ${number}) {
        merged
        state
				mergeable
				reviewDecision
        commits(last:1){
          nodes{
            commit{
              status{
                state
              }
            }
          }
        }
      }
    }
  }`;

  try {
    mergingInfo = await octokit.graphql(query, context.repo);
  } catch (err) {
    console.log('Received error from Github Graphql query: ', err);
    throw Error(err);
  }

  const { merged, state, reviewDecision, commits } = mergingInfo.repository.pullRequest;
  const mergeProblems = [];
  let mergeStatus = false;

  let prStatus = 'PENDING';
  if (commits?.nodes && commits?.nodes.length) {
    prStatus = commits.nodes[0]?.commit?.status?.state || 'PENDING';
  }

  //if (!merged && mergeable && mergeable_state === 'blocked' && state === 'OPEN' && reviewDecision === 'APPROVED' && prStatus !== 'FAILURE') {
  if (!merged && mergeable && mergeable_state === 'blocked' && state === 'OPEN' && prStatus !== 'FAILURE') {
    // Pull request should be ready for merge, let's return true here
    mergeStatus = true;
  } else {
    // Pull request is not suitable for merging, because one or many reasons. Let's push the reason(s) to the problems array
    if (merged) {
      mergeProblems.push('Ooops, you are ahead of yourself. This PR is already merged.');
    }
    if (mergeable_state === 'behind') {
      mergeProblems.push('This branch is out-of-date with the base branch. Merge the latest changes from master into this branch before requesting a merge.');
    }
    if (mergeable_state === 'dirty') {
      mergeProblems.push('There are conflicts you need to resolve before requesting a merge.');
    }
    if (state !== 'OPEN') {
      mergeProblems.push('This PR is NOT in OPEN state, which is required to be able to merge.');
    }
    if (reviewDecision !== 'APPROVED') {
      mergeProblems.push('Hey, what is going on? You need to get your PR approved before trying to merge it.');
    }
    if (prStatus === 'FAILURE') {
      mergeProblems.push('This PR is in FAILURE state. Before requesting a new merge you need to do atleast one push to your branch.');
    }
  }
  return {
    mergeStatus,
    mergeProblems,
  };
}

async function triggerPipeline(pr, branch, currentCommit) {
  const { head } = pr;
  const newCommit = await createTriggerCommit(head.ref, head.sha, currentCommit.tree.sha, branch.object.sha);
  await updateBranchRef(newCommit.data.sha);
}

async function createInfoComment(commentText, prNumber) {
  try {
    await octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: prNumber,
      body: commentText,
    });
  } catch (err) {
    console.log('Received error from Github rest API: ', err);
    throw Error(err);
  }
}

async function createCommitStatus(sha, commitStatus) {
  await octokit.rest.repos.createCommitStatus({
    ...context.repo,
    sha: sha,
    state: commitStatus,
  });
}

async function getBranchRef(branchName) {
  return await octokit.rest.git.getRef({
    ...context.repo,
    ref: `heads/${branchName}`,
  });

}

async function getCurrentCommit(sha) {
  return await octokit.rest.git.getCommit({
    ...context.repo,
    commit_sha: sha,
  });
}

async function createTriggerCommit(branchName, prSha, tree, parents) {
  return await octokit.rest.git.createCommit({
    ...context.repo,
    message: `Branch: ${branchName}, PR: ${prSha}`,
    tree: tree,
    parents: [parents],
    author: {
      name: 'GitHub',
      email: 'noreply@github.com',
    },
  });
}

async function mergePullRequest(head, baseBranch) {
  console.log('Merging main -> FB into branch ...');
  await octokit.rest.repos.merge({
    ...context.repo,
    base: head,
    head: baseBranch,
    commit_message: 'Merged base branch into feature branch.',
  });

  console.log('Merging FB -> main into branch ...');
  await octokit.rest.repos.merge({
    ...context.repo,
    base: baseBranch,
    head: head,
    merge_method: 'squash',
    commit_message: 'Automatically merged by GitHub Actions',
  });
}

async function getPullRequest(prNumber) {
  return await octokit.rest.pulls.get({
    ...context.repo,
    pull_number: prNumber,
  });
}

async function updateBranchRef(commitSha) {
  await octokit.rest.git.updateRef({
    ...context.repo,
    ref: `heads/${triggerBranch}`,
    sha: commitSha,
    force: true,
  });

}

async function getPRByCommit(sha) {
  let prs;
  try {
    const query = `query {
    repository(name: "${context.repo.repo}", owner: "${context.repo.owner}") {
      commit: object(expression: "${sha}") {
      ... on Commit {
          associatedPullRequests(first:5){
            edges{
              node{
                title
                number
                body
              }
            }
          }
        }
      }
    }
  }`;
    prs = await octokit.graphql(query, context.repo);
  } catch (err) {
    console.log('Received error from Github Graphql query: ', err);
  }
  console.log('PR-lookup ', JSON.stringify(prs) );
  console.log('PR-lookup1 ', prs.repository.commit.associatedPullRequests.edges[0].node.number );
  return prs?.respository?.commit?.associatedPullRequests?.edges?.[0]?.node?.number;
}
