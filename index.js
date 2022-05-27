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
    repository(owner: "${context.repo.owner}", name: "${context.repo.repo}") {
      pullRequest(number: ${pr.data.number}) {
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
  await octokit.graphql(query, context.repo)
  .then((mergingInfo) => {
    const { merged, state, reviewDecision, commits } = mergingInfo.repository.pullRequest;
    const { mergeable_state, mergeable } = pr.data;
    let prStatus = 'PENDING';
    if (commits?.nodes && commits?.nodes.length) {
      prStatus = commits.nodes[0]?.commit?.status?.state || 'PENDING';
    }

    if (!merged && mergeable && mergeable_state === 'blocked' && state === 'OPEN' && reviewDecision === 'APPROVED' && prStatus !== 'FAILURE') {
      // Pull request should be ready for merge, lets trigger the pipeline and run the tests
      createInfoComment('Testing CodePipeline in AWS is now triggered. If successful, your PR will be merged in a while.');
    } else {
      // Pull request is not suitable for merging, because one or many reasons. Lets create comments with the reason(s)
      if (merged) {
        createInfoComment('Ooops, you are ahead of yourself. This PR is already merged.');
      }
      if (mergeable_state === 'behind') {
        createInfoComment('This branch is out-of-date with the base branch. Merge the latest changes from master into this branch before requesting a merge.');
      }
      if (mergeable_state === 'dirty') {
        createInfoComment('There are conflicts you need to resolve before requesting a merge.');
      }
      if (state !== 'OPEN') {
        createInfoComment('This PR is NOT in OPEN state, which is required to be able to merge.');
      }
      if (reviewDecision !== 'APPROVED') {
        createInfoComment('Hey, what is going on? You need to get your PR approved before trying to merge it.');
      }
      if (prStatus === 'FAILURE') {
        createInfoComment('This PR is in FAILURE state. Before requesting a new merge you need to do atleast one push to your branch');
      }
    }
  });
}


async function createInfoComment(commentText) {
  await octokit.rest.issues.createComment({
    ...context.repo,
    issue_number: pull_request.number,
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
  createInfoComment('Manual merging is disabled. To start merging process use the slash command */merge-it* in a new comment. That will trigger testing pipeline and merging.');
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
