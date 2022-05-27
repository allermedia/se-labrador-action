const core = require('@actions/core');
const github = require('@actions/github');

const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const workflowAction = core.getInput('WORKFLOW_ACTION');
const triggerBranch = core.getInput('TRIGGER_BRANCH');
const octokit = github.getOctokit(GITHUB_TOKEN);

const { context = {} } = github;
const { pull_request } = context.payload;

async function triggerPipeline(pr) {
  const query = `query {
    repository(owner: "${context.repo.owner}", name: "${context.repo.name}") {
      pullRequest(number: ${pr.data.number}) {
        merged
        state
				mergeable
				reviewDecision
      }
    }
  }`;
  console.log(context.repo);
  await octokit.graphql(query, context.repo)
  .then((mergingInfo) => {
    console.log(mergingInfo);
  });
}


async function createInfoComment() {
  await octokit.rest.issues.createComment({
    ...context.repo,
    issue_number: pull_request.number,
    body: 'Manual merging is disabled. To start merging process use the slash command */merge-it* in a new comment. That will trigger testing pipeline and merging.',
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

async function mergePullRequest(head) {
  await octokit.rest.repos.merge({
    ...context.repo,
    base: 'master',
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
  createInfoComment();
}

if (workflowAction === 'merge-it') {
  //console.log(github.context.payload);
  getPullRequest(github.context.payload.issue.number)
  .then((pr) => {
    getBranchRef(triggerBranch)
    .then((branch) => {
      console.log(JSON.stringify(branch.data));
      getCurrentCommit(branch.data.object.sha)
      .then((currentCommit) => {
        triggerPipeline(pr);
       // console.log(JSON.stringify(currentCommit));
       /*
        createTriggerCommit(pr.data.head.ref, pr.data.head.sha, currentCommit.data.tree.sha, branch.data.object.sha)
        .then((newCommit) => {
          //console.log(newCommit);
          updateBranchRef(newCommit.data.sha);
        });
      */
      });
    });
  });
}

if (workflowAction === 'merge-now') {
  const pr = getPullRequest(github.context.payload.issue.number)
  .then((pr) => {
    createCommitStatus(pr.data.head.sha, 'success');
    mergePullRequest(pr.data.head.ref);
  });
}

if (workflowAction === 'merge-pr') {
  //createCommitStatus(github.context.payload.branches[0].commit.sha, 'success'); 
  mergePullRequest(github.context.payload.branches[0].name);
}
