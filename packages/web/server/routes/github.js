import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export function register(app, ctx) {
  const { normalizeDirectoryPath } = ctx;

  app.get('/api/github/repos', async (req, res) => {
    try {
      const userReposResult = spawnSync('gh', [
        'repo', 'list',
        '--json', 'name,nameWithOwner,description,isPrivate,url,sshUrl',
        '--limit', '100'
      ], { encoding: 'utf8', timeout: 30000 });

      if (userReposResult.error) {
        const errorMessage = userReposResult.error.message || 'GitHub CLI error';
        if (errorMessage.includes('ENOENT')) {
          return res.status(500).json({ error: 'GitHub CLI (gh) not installed' });
        }
        return res.status(500).json({ error: errorMessage });
      }

      if (userReposResult.status !== 0) {
        const stderr = userReposResult.stderr || '';
        if (stderr.includes('auth') || stderr.includes('login')) {
          return res.status(401).json({ error: 'Not logged in. Run "gh auth login" in your terminal.' });
        }
        return res.status(500).json({ error: stderr || 'GitHub CLI error' });
      }

      const userRepos = JSON.parse(userReposResult.stdout || '[]');

      const orgsResult = spawnSync('gh', [
        'org', 'list',
        '--limit', '100'
      ], { encoding: 'utf8', timeout: 30000 });

      let allRepos = [...userRepos];

      if (orgsResult.status === 0 && orgsResult.stdout) {
        const orgs = orgsResult.stdout.trim().split('\n').filter(Boolean);

        for (const org of orgs) {
          try {
            const orgReposResult = spawnSync('gh', [
              'repo', 'list', org,
              '--json', 'name,nameWithOwner,description,isPrivate,url,sshUrl',
              '--limit', '100'
            ], { encoding: 'utf8', timeout: 30000 });

            if (orgReposResult.status === 0 && orgReposResult.stdout) {
              const orgRepos = JSON.parse(orgReposResult.stdout || '[]');
              allRepos = allRepos.concat(orgRepos);
            }
          } catch (error) {
            console.warn(`Failed to fetch repos for org ${org}:`, error);
          }
        }
      }

      const mapped = allRepos.map((r) => ({
        name: r.name,
        fullName: r.nameWithOwner,
        description: r.description,
        isPrivate: r.isPrivate,
        url: r.url,
        cloneUrl: r.url + '.git'
      }));

      res.json(mapped);
    } catch (error) {
      console.error('Failed to fetch GitHub repos:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch GitHub repositories' });
    }
  });

  app.post('/api/github/clone', async (req, res) => {
    try {
      const { cloneUrl, targetDirectory } = req.body;

      if (!cloneUrl || typeof cloneUrl !== 'string') {
        return res.status(400).json({ error: 'Clone URL is required' });
      }
      if (!targetDirectory || typeof targetDirectory !== 'string') {
        return res.status(400).json({ error: 'Target directory is required' });
      }

      const expandedPath = normalizeDirectoryPath(targetDirectory);
      const resolvedPath = path.resolve(expandedPath);

      let finalPath = resolvedPath;
      if (fs.existsSync(finalPath)) {
        let suffix = 2;
        while (fs.existsSync(`${resolvedPath}-${suffix}`)) {
          suffix++;
          if (suffix > 100) {
            return res.status(400).json({ error: 'Too many directories with similar names exist' });
          }
        }
        finalPath = `${resolvedPath}-${suffix}`;
      }

      const parentDir = path.dirname(finalPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const result = spawnSync('git', ['clone', '--depth', '1', '--single-branch', cloneUrl, finalPath], {
        encoding: 'utf8',
        timeout: 300000
      });

      if (result.error) {
        return res.status(500).json({ error: result.error.message || 'Git clone failed' });
      }

      if (result.status !== 0) {
        return res.status(500).json({ error: result.stderr || 'Git clone failed' });
      }

      res.json({ success: true, path: finalPath });
    } catch (error) {
      console.error('Failed to clone repository:', error);
      res.status(500).json({ error: error.message || 'Failed to clone repository' });
    }
  });

  app.get('/api/github/pr-status', async (req, res) => {
    try {
      const { cwd } = req.query;

      if (!cwd || typeof cwd !== 'string') {
        return res.status(400).json({ error: 'cwd query parameter is required' });
      }

      const expandedPath = normalizeDirectoryPath(cwd);
      if (!fs.existsSync(expandedPath)) {
        return res.status(400).json({ error: 'Directory does not exist' });
      }

      const prViewResult = spawnSync('gh', [
        'pr', 'view',
        '--json', 'number,title,url,state,isDraft,headRefName,baseRefName,additions,deletions,changedFiles,reviewDecision,statusCheckRollup,reviews,comments,mergeable,mergeStateStatus'
      ], { encoding: 'utf8', timeout: 30000, cwd: expandedPath });

      if (prViewResult.error) {
        const errorMessage = prViewResult.error.message || 'GitHub CLI error';
        if (errorMessage.includes('ENOENT')) {
          return res.status(500).json({ error: 'GitHub CLI (gh) not installed' });
        }
        return res.status(500).json({ error: errorMessage });
      }

      if (prViewResult.status !== 0) {
        const stderr = prViewResult.stderr || '';
        if (stderr.includes('no pull requests found') || stderr.includes('not a git repository')) {
          return res.json({ success: true, pr: null });
        }
        if (stderr.includes('auth') || stderr.includes('login')) {
          return res.status(401).json({ error: 'Not logged in. Run "gh auth login" in your terminal.' });
        }
        return res.status(500).json({ error: stderr || 'GitHub CLI error' });
      }

      const prData = JSON.parse(prViewResult.stdout || '{}');

      let reviewThreads = [];
      try {
        const prNumber = prData.number;
        if (prNumber) {
          const repoResult = spawnSync('gh', [
            'repo', 'view', '--json', 'owner,name'
          ], { encoding: 'utf8', timeout: 10000, cwd: expandedPath });

          let repoOwner = '';
          let repoName = '';
          if (repoResult.status === 0 && repoResult.stdout) {
            const repoData = JSON.parse(repoResult.stdout || '{}');
            repoOwner = repoData.owner?.login || '';
            repoName = repoData.name || '';
          }

          if (repoOwner && repoName) {
            const graphqlQuery = `
              query($owner: String!, $name: String!, $number: Int!) {
                repository(owner: $owner, name: $name) {
                  pullRequest(number: $number) {
                    reviewThreads(first: 100) {
                      nodes {
                        id
                        isResolved
                        isOutdated
                        path
                        line
                        comments(first: 50) {
                          nodes {
                            id
                            body
                            path
                            author { login }
                            createdAt
                          }
                        }
                      }
                    }
                  }
                }
              }
            `;

            const graphqlResult = spawnSync('gh', [
              'api', 'graphql',
              '-F', `owner=${repoOwner}`,
              '-F', `name=${repoName}`,
              '-F', `number=${prNumber}`,
              '-f', `query=${graphqlQuery}`
            ], { encoding: 'utf8', timeout: 30000, cwd: expandedPath });

            if (graphqlResult.status === 0 && graphqlResult.stdout) {
              const graphqlData = JSON.parse(graphqlResult.stdout || '{}');
              const threads = graphqlData?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];

              reviewThreads = threads.map(thread => ({
                id: thread.id,
                isResolved: thread.isResolved,
                isOutdated: thread.isOutdated,
                path: thread.path,
                line: thread.line,
                comments: (thread.comments?.nodes || []).map(c => ({
                  id: c.id,
                  body: c.body,
                  path: c.path || thread.path,
                  line: thread.line,
                  author: { login: c.author?.login || 'unknown' },
                  createdAt: c.createdAt
                }))
              }));

              reviewThreads.sort((a, b) => {
                const aTime = a.comments[0]?.createdAt ? new Date(a.comments[0].createdAt).getTime() : 0;
                const bTime = b.comments[0]?.createdAt ? new Date(b.comments[0].createdAt).getTime() : 0;
                return aTime - bTime;
              });
            }
          }
        }
      } catch (parseErr) {
        console.warn('Failed to fetch review threads:', parseErr);
      }

      const statusChecks = (prData.statusCheckRollup || []).map(check => ({
        context: check.context,
        name: check.name || check.context,
        state: check.state,
        status: check.status,
        conclusion: check.conclusion,
        targetUrl: check.targetUrl || check.detailsUrl,
        detailsUrl: check.detailsUrl || check.targetUrl,
        description: check.description,
        startedAt: check.startedAt,
        completedAt: check.completedAt
      }));

      const pr = {
        number: prData.number,
        title: prData.title,
        url: prData.url,
        state: prData.state,
        isDraft: prData.isDraft,
        headRefName: prData.headRefName,
        baseRefName: prData.baseRefName,
        additions: prData.additions,
        deletions: prData.deletions,
        changedFiles: prData.changedFiles,
        reviewDecision: prData.reviewDecision,
        mergeable: prData.mergeable,
        mergeStateStatus: prData.mergeStateStatus,
        reviewThreads: reviewThreads,
        statusCheckRollup: statusChecks
      };

      res.json({ success: true, pr });
    } catch (error) {
      console.error('Failed to fetch PR status:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch PR status' });
    }
  });

  app.get('/api/github/:owner/:repo/prs', async (req, res) => {
    const { owner, repo } = req.params;

    if (!owner || !repo) {
      return res.status(400).json({ error: 'Owner and repo are required' });
    }

    try {
      // Check if gh CLI is available
      const versionCheck = spawnSync('gh', ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (versionCheck.error || versionCheck.status !== 0) {
        return res.status(503).json({
          error: 'GitHub CLI (gh) not installed',
          message: 'Please install gh CLI: https://cli.github.com/'
        });
      }

      const result = spawnSync('gh', [
        'pr', 'list',
        '--repo', `${owner}/${repo}`,
        '--json', 'number,title,state,isDraft,author,headRefName,baseRefName,additions,deletions,labels,createdAt,updatedAt,reviewDecision,statusCheckRollup,mergeable',
        '--limit', '100'
      ], { encoding: 'utf8', timeout: 30000 });

      if (result.error) {
        return res.status(500).json({ error: result.error.message || 'GitHub CLI error' });
      }

      if (result.status !== 0) {
        const stderr = result.stderr || '';
        if (stderr.includes('authentication') || stderr.includes('auth') || stderr.includes('login')) {
          return res.status(401).json({
            error: 'GitHub authentication required',
            message: 'Run: gh auth login'
          });
        }
        if (stderr.includes('not found') || stderr.includes('404')) {
          return res.status(404).json({
            error: 'Repository not found',
            message: `Could not find ${owner}/${repo}`
          });
        }
        return res.status(500).json({ error: stderr || 'Failed to fetch PRs' });
      }

      const prs = JSON.parse(result.stdout || '[]');

      const transformedPrs = prs.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state.toLowerCase(),
        isDraft: pr.isDraft,
        author: pr.author?.login || 'unknown',
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        labels: (pr.labels || []).map(l => l.name),
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        reviewDecision: pr.reviewDecision || null,
        statusCheckRollup: pr.statusCheckRollup?.state || null,
        mergeable: pr.mergeable || 'UNKNOWN'
      }));

      res.json({ success: true, prs: transformedPrs });
    } catch (error) {
      console.error('Failed to fetch GitHub PRs:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch PRs' });
    }
  });
}
