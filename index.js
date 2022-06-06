const core = require('@actions/core');
const github = require('@actions/github');

const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const workflowAction = core.getInput('WORKFLOW_ACTION');
const triggerBranch = core.getInput('TRIGGER_BRANCH');
const baseBranch = core.getInput('BASE_BRANCH');
const octokit = github.getOctokit(GITHUB_TOKEN);

const { context = {} } = github;
const { pull_request } = context.payload;

async function canBeMerged(pr) {
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
  const mergingInfo = await octokit.graphql(query, context.repo);
  const { merged, state, reviewDecision, commits } = mergingInfo.repository.pullRequest;
  const mergeProblems = [];
  let mergeStatus = false;

  let prStatus = 'PENDING';
  if (commits?.nodes && commits?.nodes.length) {
    prStatus = commits.nodes[0]?.commit?.status?.state || 'PENDING';
  }

  if (!merged && mergeable && mergeable_state === 'blocked' && state === 'OPEN' && reviewDecision === 'APPROVED' && prStatus !== 'FAILURE') {
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
  createTriggerCommit(head.ref, head.sha, currentCommit.tree.sha, branch.object.sha)
  .then((newCommit) => {
    updateBranchRef(newCommit.data.sha);
  });
}


async function createInfoComment(commentText, prNumber) {
  await octokit.rest.issues.createComment({
    ...context.repo,
    issue_number: prNumber,
    body: commentText,
  });  
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
  })
}

async function mergePullRequest(head, baseBranch) {
  await octokit.rest.repos.merge({
    ...context.repo,
    base: head,
    head: baseBranch,
    commit_message: 'Merged base branch into feature branch.',
  });  
  await octokit.rest.repos.merge({
    ...context.repo,
    base: baseBranch,
    head: head,
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

if (workflowAction === 'prinit') {
  createCommitStatus(pull_request.head.sha, 'pending'); 
  createInfoComment('Manual merging is disabled. To start merging process use the slash command */merge-it* in a new comment. That will trigger testing pipeline and merging.', pull_request.number);
}

if (workflowAction === 'merge-it') {
  getPullRequest(github.context.payload.issue.number)
  .then((pr) => {
    getBranchRef(triggerBranch)
    .then((branch) => {
      getCurrentCommit(branch.data.object.sha)
      .then((currentCommit) => {
        triggerPipeline(pr.data, branch.data, currentCommit.data);
      });
    });
  });
}

if (workflowAction === 'merge-now') {
  getPullRequest(github.context.payload.issue.number)
  .then((pr) => {
    canBeMerged(pr.data)
    .then((precheck) => {
      if (precheck.mergeStatus) {
        createCommitStatus(pr.data.head.sha, 'success');
        mergePullRequest(pr.data.head.ref, baseBranch);
      } else {
        if (precheck.mergeProblems.length) {
          precheck.mergeProblems.forEach((problem) => {
            createInfoComment(problem, github.context.payload.issue.number);
          });
        }
      }
    });
  });
}

if (workflowAction === 'merge-pr') {
  mergePullRequest(github.context.payload.branches[0].name, baseBranch);
}
