const core = require('@actions/core');
const github = require('@actions/github');

const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const workflowAction = core.getInput('WORKFLOW_ACTION');
const octokit = github.getOctokit(GITHUB_TOKEN);

const { context = {} } = github;
const { pull_request } = context.payload;

const triggerCommitSha = '294db24e486c72904c036f7a40b8e84971572d25';

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

async function createTriggerCommit(branchName, prSha) {
  return await octokit.rest.git.createCommit({
    ...context.repo,
    message: `Branch: ${branchName}, PR: ${prSha}`,
    tree: triggerCommitSha,
    parents: ['c2a20ce6522c248619700376372354221633e46c'],
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

if (workflowAction === 'prinit') {
  createCommitStatus(pull_request.head.sha, 'pending'); 
  createInfoComment();
}

if (workflowAction === 'merge-it') {
  //console.log(github.context.payload);
  const pr = getPullRequest(github.context.payload.issue.number)
  .then((pr) => {
    createTriggerCommit(pr.data.head.ref, pr.data.head.sha)
    .then((response) => {
      console.log(response);
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
