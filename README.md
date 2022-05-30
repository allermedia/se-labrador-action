# se-labrador-action

A set of GitHub Actions (JavaScript) to trigger an AWS CodePipeline with a specific slash command in the PR comments. 

# About

This merge flow disables the possibility to use the merge button in a pull request. The merge is instead decided by scripts.

# Logic

## Triggered when a pull request is created (opened)

An information comment is created - describing that manual merging is disabled. The PR is set to a pending state, which will
disable the merge button. 

## A merge is requested by a slash command

When PR is done, a merge request must be issued by typing the slash command `/merge-it` in the comments fields of the PR.
To be able to merge a PR a series of conditions must first be met before triggering the AWS CodePipeline. The following
conditions must be met:

1. PR is in OPEN state
2. PR is NOT already MERGED
3. PR is NOT out-of-date with the base branch
4. PR is NOT in CONFLICTING state (conflicts must first be resolved)
5. PR is NOT in FAILURE state (At least one push is required to trigger merge again)
6. PR is APPROVED by required reviewers

## An emergency merge is requested by a slash command

If a PR must be merged right away, without running tests a special slash command `/merge-now` can be issued in the comments fields of the PR.
Note: The above conditions must still be met to use the emergency merging command. Should only be used if really needed.

# About triggering AWS CodePipeline (or any other external logic)

In the settings of the GitHub workflow file a "trigger branch" is defined. This is the name of a branch where an empty commit will be made to.
AWS will listen to push on that particular branch. The commit message will contain a message with the branch name and head SHA of the PR.
`Branch: <Branch Name>, PR: <Head SHA of PR>`.

# How AWS CodePipeline reports back

If the CodePipeline which runs all tests is successful, it needs to trigger the actual merging of the PR branch into the base branch. This is done
by adding a new state to the latest commit of the PR. Two different states can be reported back: `success` or `failure`. This can be done using
the GitHub API. A new `success` state will trigger a workflow which will merge the PR into the base branch. A new `failure` state will require at least
one more push to the PR branch before a new merge can be requested.

# Updating this action

## Public repository

>___This is a public repository___. 

Keep any Aller specific secrets and other sensitive information away from this repository. Also, pass branch names and other
data as variables from the workflow definitions rather than hardcoding them in the action source file. 

## Feature branches

All work should be done in feature branches. Branches should have human readable name, and when needed, some sort of ID
used fe. Jira. (fe. `SELAB-001-my-first-branch`, or `my-first-branch` when not used with linked tickets)

## Versions and tagging

This codebase is versioned by tags. These tags are used when defining which version to use in the workflow defintion files in the repository it is used in.
To tag a new version:

```bash
git commit -m "Version 1.67"
git tag -a -m "Version 1.67" v1.67
git push ... --follow-tags
```
Note: ... should be replaced with specific branch names etc.

## Merging

Merging to master should happen through pull requests. Any pull request should have been approved by at least one person before
merging.

# Local development

Because this GitHub action is dependent on hydration of event based payloads and a temporary GITHUB_TOKEN it is not possible to run this action in a localhost
environment.

# GitHub repository settings

The base branch of the repository where this action is used needs to be a protected branch with a branch protection rule like this:

- Enable *require a pull request before merging*
- Enable *require approvals*
- Enable *dismiss stale pull request approvals when new commits are pushed*
- Enable *require status checks to pass before merging* (Select/search for a check with name *default* and select *any source*)

# Workflow files

Place the following .yml files in the .github / workflows folder in the project where the workflows should be used.

```yaml
on:
  pull_request:
    types: [opened, reopened]

jobs:
  prinit:
    runs-on: ubuntu-latest
    name: New PR action
    steps:
      - name: Make an info comment and disable merging
        id: init
        uses: allermedia/se-labrador-action@v1.68
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WORKFLOW_ACTION: 'prinit'
```


```yaml
on: issue_comment

jobs:
  pr_commented:
    # This job only runs for pull request comments
    name: Check PR comment for merge-it slash command
    if: ${{ github.event.issue.pull_request }}
    runs-on: ubuntu-latest
    steps:
      - name: merge-it
        if: ${{ contains(github.event.comment.body, '/merge-it') }}
        uses: allermedia/se-labrador-action@v1.67
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WORKFLOW_ACTION: 'merge-it'
          TRIGGER_BRANCH: 'live'
          BASE_BRANCH: 'master'
 ```

```yaml
on: issue_comment

jobs:
  pr_commented_now:
    # This job only runs for pull request comments
    name: Check PR comment for merge-now slash command
    if: ${{ github.event.issue.pull_request }}
    runs-on: ubuntu-latest
    steps:
      - name: merge-now
        if: ${{ contains(github.event.comment.body, '/merge-now') }}
        uses: allermedia/se-labrador-action@v1.68
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WORKFLOW_ACTION: 'merge-now'
          BASE_BRANCH: 'master'
```

```yaml
on:
  status

jobs:
  if_success:
    name: Merge if status changed to success
    if: ${{ github.event.state == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - name: merge
        uses: allermedia/se-labrador-action@v1.68
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WORKFLOW_ACTION: 'merge-pr'
          BASE_BRANCH: 'master'
```

# Disclaimer
This action is developed by Aller Media and can be deleted or modified at any time without notice. 