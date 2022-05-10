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
    body: 'Manual merging is disabled. To start merging process use the slash command */merge-it* in a new comment. That will trigger testing pipeline and merging.'
  });  
}

async function createCommitStatus() {
  await octokit.rest.repos.createCommitStatus({
    ...context.repo,
    sha: pull_request.head.sha,
    state: 'pending'
  });  
}

if (workflowAction === 'prinit') {
  createCommitStatus(); 
  createInfoComment();
}

if (workflowAction === 'merge-it') {
  console.log('merge-it');
}

if (workflowAction === 'merge-now') {
  console.log('merge-now');
}
