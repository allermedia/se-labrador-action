const core = require('@actions/core');
const github = require('@actions/github');

const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const workflowAction = core.getInput('WORKFLOW_ACTION');
const octokit = github.getOctokit(GITHUB_TOKEN);

const { context = {} } = github;
const { pull_request } = context.payload;

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

async function mergePullRequest() {
  await octokit.rest.repos.merge({
    ...context.repo,
    base: 'master',
    head: github.context.payload.branches[0].name,
    commit_message: 'Automatically merged by GitHub Actions',
  });  
}

if (workflowAction === 'prinit') {
  createCommitStatus(pull_request.head.sha, 'failure'); 
  createInfoComment();
}

if (workflowAction === 'merge-it') {
  console.log(github.context.payload);
}

if (workflowAction === 'merge-now') {
  console.log('merge-now');
}

if (workflowAction === 'merge-pr') {
  createCommitStatus(github.context.payload.branches[0].commit.sha, 'success'); 
  mergePullRequest();
}
