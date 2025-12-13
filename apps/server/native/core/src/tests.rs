use crate::{
    diff::refs,
    repo::cache::{ensure_repo, resolve_repo_url},
    types::{GitDiffOptions, GitDiffWorkspaceOptions},
    util::run_git,
};
#[cfg_attr(not(feature = "fuzz-tests"), allow(unused_imports))]
use rayon::{prelude::*, ThreadPoolBuilder};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::{
    cell::RefCell,
    collections::HashMap,
    fs,
    process::Command,
    sync::{Mutex, OnceLock},
};
use tempfile::{tempdir, TempDir};

fn run(cwd: &std::path::Path, cmd: &str) {
    let status = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .arg("/C")
            .arg(cmd)
            .current_dir(cwd)
            .status()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .current_dir(cwd)
            .status()
    }
    .expect("spawn");
    assert!(status.success(), "command failed: {cmd}");
}

fn find_git_root(mut p: PathBuf) -> PathBuf {
    loop {
        if p.join(".git").exists() {
            return p;
        }
        if !p.pop() {
            break;
        }
    }
    panic!(".git not found from test cwd");
}

#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
const LARGE_MAX_BYTES: i32 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroundTruthFile {
    #[allow(dead_code)]
    generated_at: String,
    repos: HashMap<String, Vec<PullRequestRecord>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
struct PullRequestRecord {
    repo: String,
    number: u64,
    #[allow(dead_code)]
    is_merged: bool,
    merge_commit_sha: Option<String>,
    last_commit_sha: String,
    #[allow(dead_code)]
    base_sha: String,
    additions: i64,
    deletions: i64,
    changed_files: i64,
}

#[derive(Clone, Debug)]
#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
struct CachedDiff {
    additions: i64,
    deletions: i64,
    changed_files: usize,
    debug: refs::DiffComputationDebug,
    base_repo_path: PathBuf,
}

static GROUND_TRUTH: OnceLock<GroundTruthFile> = OnceLock::new();
static PULL_FETCH_CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
static DIFF_CACHE: OnceLock<Mutex<HashMap<String, CachedDiff>>> = OnceLock::new();

struct ThreadRepoClone {
    _tempdir: TempDir,
    path: PathBuf,
    source: PathBuf,
}

thread_local! {
  static THREAD_REPO_CLONES: RefCell<HashMap<String, ThreadRepoClone>> = RefCell::new(HashMap::new());
}

fn ground_truth() -> &'static GroundTruthFile {
    GROUND_TRUTH.get_or_init(|| {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = find_git_root(manifest_dir);
        let path = match std::env::var("PR_GROUND_TRUTH_PATH") {
            Ok(value) => {
                let override_path = PathBuf::from(value);
                if override_path.is_absolute() {
                    override_path
                } else {
                    repo_root.join(override_path)
                }
            }
            Err(_) => repo_root.join("data/github/pr-ground-truth.json"),
        };
        let json = fs::read_to_string(&path).unwrap_or_else(|err| {
            panic!("failed to read ground truth file {}: {err}", path.display())
        });
        serde_json::from_str(&json).unwrap_or_else(|err| {
            panic!(
                "failed to parse ground truth file {}: {err}",
                path.display()
            )
        })
    })
}

fn ensure_repo_with_pull_refs(repo_slug: &str) -> PathBuf {
    let url = resolve_repo_url(Some(repo_slug), None).expect("resolve repo url");
    let repo_path = ensure_repo(&url).expect("ensure repo path");
    let repo_path_str = repo_path.to_string_lossy().to_string();

    let cache = PULL_FETCH_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let already_fetched = {
        let map = cache.lock().expect("pull fetch cache lock");
        map.get(repo_slug).copied().unwrap_or(false)
    };

    if !already_fetched {
        run_git(
            &repo_path_str,
            &[
                "fetch",
                "origin",
                "+refs/pull/*/head:refs/cmux-tests/pull/*",
            ],
        )
        .unwrap_or_else(|err| panic!("failed to fetch pull refs for {repo_slug}: {err}"));
        let mut map = cache.lock().expect("pull fetch cache lock");
        map.insert(repo_slug.to_string(), true);
    }

    repo_path
}

fn canonicalize_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn create_thread_repo_clone(repo_slug: &str, base_repo: &Path) -> ThreadRepoClone {
    let tempdir = tempfile::tempdir().expect("create tempdir for repo clone");
    let clone_path = tempdir.path().join("repo");
    let cwd = tempdir.path().to_string_lossy().to_string();
    let base = base_repo.to_string_lossy().to_string();
    let dest = clone_path.to_string_lossy().to_string();
    run_git(&cwd, &["clone", "--local", "--no-hardlinks", &base, &dest])
        .unwrap_or_else(|err| panic!("failed to clone local repo for {repo_slug}: {err}"));
    ThreadRepoClone {
        _tempdir: tempdir,
        path: clone_path,
        source: canonicalize_path(base_repo),
    }
}

fn repo_clone_for_thread(repo_slug: &str, base_repo: &Path) -> PathBuf {
    let base_canon = canonicalize_path(base_repo);
    THREAD_REPO_CLONES.with(|cell| {
        let mut map = cell.borrow_mut();
        let needs_new = match map.get(repo_slug) {
            Some(existing) => existing.source != base_canon,
            None => true,
        };
        if needs_new {
            map.insert(
                repo_slug.to_string(),
                create_thread_repo_clone(repo_slug, &base_canon),
            );
        }
        map.get(repo_slug).unwrap().path.clone()
    })
}

#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
fn reset_thread_repo_clone(repo_slug: &str) {
    THREAD_REPO_CLONES.with(|cell| {
        cell.borrow_mut().remove(repo_slug);
    });
}

fn compute_diff_for_pr(pr: &PullRequestRecord) -> CachedDiff {
    let cache_key = format!("{}#{}", pr.repo, pr.number);
    let cache = DIFF_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(entry) = cache
        .lock()
        .expect("diff cache lock")
        .get(&cache_key)
        .cloned()
    {
        return entry;
    }

    let base_repo_path = canonicalize_path(&ensure_repo_with_pull_refs(&pr.repo));
    let repo_clone = repo_clone_for_thread(&pr.repo, &base_repo_path);
    let repo_path_str = repo_clone.to_string_lossy().to_string();
    let diff = crate::diff::refs::diff_refs(GitDiffOptions {
        headRef: pr.last_commit_sha.clone(),
        baseRef: None,
        repoFullName: Some(pr.repo.clone()),
        repoUrl: None,
        teamSlugOrId: None,
        originPathOverride: Some(repo_path_str.clone()),
        includeContents: Some(true),
        maxBytes: Some(LARGE_MAX_BYTES),
        lastKnownBaseSha: None,
        lastKnownMergeCommitSha: None,
    })
    .unwrap_or_else(|err| panic!("diff_refs failed for {}#{}: {err}", pr.repo, pr.number));

    let debug = refs::last_diff_debug()
        .unwrap_or_else(|| panic!("missing diff debug for {}#{}", pr.repo, pr.number));

    let additions: i64 = diff.iter().map(|entry| entry.additions as i64).sum();
    let deletions: i64 = diff.iter().map(|entry| entry.deletions as i64).sum();
    let changed_files = diff.len();

    let cached = CachedDiff {
        additions,
        deletions,
        changed_files,
        debug,
        base_repo_path: base_repo_path.clone(),
    };
    cache
        .lock()
        .expect("diff cache lock")
        .insert(cache_key, cached.clone());
    cached
}

fn commit_parents(repo_path: &Path, commit: &str) -> Option<Vec<String>> {
    let repo_str = repo_path.to_string_lossy().to_string();
    match run_git(&repo_str, &["rev-list", "--parents", "-n", "1", commit]) {
        Ok(output) => Some(
            output
                .split_whitespace()
                .skip(1)
                .map(|s| s.to_string())
                .collect(),
        ),
        Err(err) => {
            eprintln!("commit {} not found in {}: {}", commit, repo_str, err);
            None
        }
    }
}

fn ensure_merge_commit(base_repo: &Path, pr_number: u64, merge_sha: &str) -> bool {
    let repo_str = base_repo.to_string_lossy().to_string();
    if run_git(
        &repo_str,
        &["cat-file", "-e", &format!("{merge_sha}^{{commit}}")],
    )
    .is_ok()
    {
        return true;
    }
    if run_git(&repo_str, &["fetch", "origin", merge_sha]).is_ok()
        && run_git(
            &repo_str,
            &["cat-file", "-e", &format!("{merge_sha}^{{commit}}")],
        )
        .is_ok()
    {
        return true;
    }
    let merge_spec = format!(
        "refs/pull/{}/merge:refs/cmux-tests/merge/{}",
        pr_number, pr_number
    );
    run_git(&repo_str, &["fetch", "origin", &merge_spec]).is_ok()
}

#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
#[derive(Default, Clone, Debug)]
struct MergeStats {
    total_with_merge: usize,
    matches: usize,
    fallback_matches: usize,
    matches_second_parent: usize,
    compare_equal_head: usize,
    mismatches: usize,
    single_parent: usize,
    missing_commits: usize,
    missing_after_fetch: usize,
    fetch_attempts: usize,
    fetch_success: usize,
    fallback_used: usize,
    no_merge_commit: usize,
    unmatched_with_merge_oid: usize,
}

#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
impl MergeStats {
    fn accumulate(&mut self, other: &MergeStats) {
        self.total_with_merge += other.total_with_merge;
        self.matches += other.matches;
        self.fallback_matches += other.fallback_matches;
        self.matches_second_parent += other.matches_second_parent;
        self.compare_equal_head += other.compare_equal_head;
        self.mismatches += other.mismatches;
        self.single_parent += other.single_parent;
        self.missing_commits += other.missing_commits;
        self.missing_after_fetch += other.missing_after_fetch;
        self.fetch_attempts += other.fetch_attempts;
        self.fetch_success += other.fetch_success;
        self.fallback_used += other.fallback_used;
        self.no_merge_commit += other.no_merge_commit;
        self.unmatched_with_merge_oid += other.unmatched_with_merge_oid;
    }
}

#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
#[derive(Clone, Debug)]
struct MergeMismatch {
    repo: String,
    number: u64,
    compare_base: String,
    base_parent: String,
    head_parent: String,
    merge_commit: Option<String>,
    reason: &'static str,
}

#[cfg_attr(not(feature = "fuzz-tests"), allow(dead_code))]
fn evaluate_merge_pr(pr: &PullRequestRecord) -> (MergeStats, Option<MergeMismatch>) {
    let mut stats = MergeStats::default();
    if pr.merge_commit_sha.is_none() {
        stats.no_merge_commit = 1;
        // Warm the diff cache for subsequent tests
        let _ = compute_diff_for_pr(pr);
        return (stats, None);
    }

    let merge_sha = pr.merge_commit_sha.as_ref().unwrap();
    let cached = compute_diff_for_pr(pr);
    stats.total_with_merge = 1;
    if cached.debug.merge_commit_oid.is_some() {
        stats.fallback_used = 1;
    }

    let compare_oid = cached.debug.compare_base_oid.clone();
    let head_oid = cached.debug.head_oid.clone();
    let clone_path = PathBuf::from(&cached.debug.repo_path);
    let base_path = cached.base_repo_path.clone();

    let mut parents =
        commit_parents(&clone_path, merge_sha).or_else(|| commit_parents(&base_path, merge_sha));
    let mut fetch_attempted = false;
    if parents.is_none() {
        fetch_attempted = true;
        stats.fetch_attempts = 1;
        if ensure_merge_commit(&base_path, pr.number, merge_sha) {
            stats.fetch_success = 1;
            reset_thread_repo_clone(&pr.repo);
            parents = commit_parents(&base_path, merge_sha);
        }
    }

    match parents {
        None => {
            stats.missing_commits = 1;
            if fetch_attempted {
                stats.missing_after_fetch = 1;
            }
            (
                stats,
                Some(MergeMismatch {
                    repo: pr.repo.clone(),
                    number: pr.number,
                    compare_base: compare_oid,
                    base_parent: String::new(),
                    head_parent: String::new(),
                    merge_commit: Some(merge_sha.clone()),
                    reason: "missing merge commit",
                }),
            )
        }
        Some(list) => {
            if list.len() < 2 {
                stats.single_parent = 1;
                return (stats, None);
            }
            let base_parent = &list[0];
            let head_parent = &list[1];
            if *base_parent == compare_oid {
                stats.matches = 1;
                if cached.debug.merge_commit_oid.is_some() {
                    stats.fallback_matches = 1;
                }
                println!(
          "[evaluate] match {}#{} compare={} base_parent={} head_parent={} merge_commit={:?}",
          pr.repo,
          pr.number,
          compare_oid,
          base_parent,
          head_parent,
          pr.merge_commit_sha,
        );
                (stats, None)
            } else if *head_parent == compare_oid {
                stats.matches_second_parent = 1;
                (stats, None)
            } else if head_oid == compare_oid {
                stats.compare_equal_head = 1;
                stats.mismatches = 1;
                (
                    stats,
                    Some(MergeMismatch {
                        repo: pr.repo.clone(),
                        number: pr.number,
                        compare_base: compare_oid,
                        base_parent: base_parent.clone(),
                        head_parent: head_parent.clone(),
                        merge_commit: Some(merge_sha.clone()),
                        reason: "compare equals head",
                    }),
                )
            } else {
                stats.mismatches = 1;
                if cached.debug.merge_commit_oid.is_some() {
                    stats.unmatched_with_merge_oid = 1;
                }
                (
                    stats,
                    Some(MergeMismatch {
                        repo: pr.repo.clone(),
                        number: pr.number,
                        compare_base: compare_oid,
                        base_parent: base_parent.clone(),
                        head_parent: head_parent.clone(),
                        merge_commit: pr.merge_commit_sha.clone(),
                        reason: "compare differs from merge first parent",
                    }),
                )
            }
        }
    }
}

#[test]
fn workspace_diff_basic() {
    let tmp = tempdir().unwrap();
    let work = tmp.path().join("work");
    fs::create_dir_all(&work).unwrap();
    run(&work, "git init");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test checkout -b main",
    );
    fs::write(work.join("a.txt"), b"a1\n").unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m init",
    );

    fs::write(work.join("a.txt"), b"a1\na2\n").unwrap();
    fs::create_dir_all(work.join("src")).unwrap();
    fs::write(work.join("src/new.txt"), b"x\ny\n").unwrap();

    let out = crate::diff::workspace::diff_workspace(GitDiffWorkspaceOptions {
        worktreePath: work.to_string_lossy().to_string(),
        includeContents: Some(true),
        maxBytes: Some(1024 * 1024),
    })
    .unwrap();

    let mut has_a = false;
    let mut has_new = false;
    for e in &out {
        if e.filePath == "a.txt" {
            has_a = true;
        }
        if e.filePath == "src/new.txt" {
            has_new = true;
        }
    }
    assert!(has_a && has_new, "expected modified and untracked files");
}

#[test]
fn workspace_diff_unborn_head_uses_remote_default() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();

    // Create bare origin with a main branch and one file
    let origin_path = root.join("origin.git");
    fs::create_dir_all(&origin_path).unwrap();
    run(
        root,
        &format!(
            "git init --bare {}",
            origin_path.file_name().unwrap().to_str().unwrap()
        ),
    );

    // Seed repo to populate origin/main
    let seed = root.join("seed");
    fs::create_dir_all(&seed).unwrap();
    run(&seed, "git init");
    run(
        &seed,
        "git -c user.email=a@b -c user.name=test checkout -b main",
    );
    fs::write(seed.join("a.txt"), b"one\n").unwrap();
    run(&seed, "git add .");
    run(
        &seed,
        "git -c user.email=a@b -c user.name=test commit -m init",
    );

    // Point origin HEAD to main and push
    let origin_url = origin_path.to_string_lossy().to_string();
    run(&seed, &format!("git remote add origin {}", origin_url));
    // Ensure origin default branch is main
    run(&origin_path, "git symbolic-ref HEAD refs/heads/main");
    run(&seed, "git push -u origin main");

    // Create work repo with unborn HEAD, add remote, fetch only
    let work = root.join("work");
    fs::create_dir_all(&work).unwrap();
    run(&work, "git init");
    run(&work, &format!("git remote add origin {}", origin_url));
    run(&work, "git fetch origin");

    // Modify file relative to remote default without any local commit
    fs::write(work.join("a.txt"), b"one\ntwo\n").unwrap();

    let out = crate::diff::workspace::diff_workspace(GitDiffWorkspaceOptions {
        worktreePath: work.to_string_lossy().to_string(),
        includeContents: Some(true),
        maxBytes: Some(1024 * 1024),
    })
    .expect("diff workspace unborn");

    // Expect a diff against remote default: a.txt should be modified
    if !out.iter().any(|e| e.filePath == "a.txt") {
        eprintln!(
            "entries: {:?}",
            out.iter()
                .map(|e| format!("{}:{}", e.status, e.filePath))
                .collect::<Vec<_>>()
        );
    }
    let row = out
        .iter()
        .find(|e| e.filePath == "a.txt")
        .expect("has a.txt");
    assert_eq!(row.status, "modified");
    assert_eq!(row.contentOmitted, Some(false));
    assert!(row.oldContent.as_deref() == Some("one\n"));
    assert!(row.newContent.as_deref() == Some("one\ntwo\n"));
    assert!(row.additions >= 1);
}

#[test]
fn refs_diff_basic_on_local_repo() {
    let tmp = tempdir().unwrap();
    let work = tmp.path().join("repo");
    std::fs::create_dir_all(&work).unwrap();
    run(&work, "git init");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test checkout -b main",
    );
    std::fs::write(work.join("a.txt"), b"a1\n").unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m init",
    );
    run(&work, "git checkout -b feature");
    std::fs::write(work.join("b.txt"), b"b\n").unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m change",
    );

    let out = crate::diff::refs::diff_refs(GitDiffOptions {
        baseRef: Some("main".into()),
        headRef: "feature".into(),
        repoFullName: None,
        repoUrl: None,
        teamSlugOrId: None,
        originPathOverride: Some(work.to_string_lossy().to_string()),
        includeContents: Some(true),
        maxBytes: Some(1024 * 1024),
        lastKnownBaseSha: None,
        lastKnownMergeCommitSha: None,
    })
    .unwrap();

    assert!(out.iter().any(|e| e.filePath == "b.txt"));
}

#[test]
fn refs_merge_base_after_merge_is_branch_tip() {
    let tmp = tempdir().unwrap();
    let work = tmp.path().join("repo");
    fs::create_dir_all(&work).unwrap();

    run(&work, "git init");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test checkout -b main",
    );
    std::fs::write(work.join("file.txt"), b"base\n").unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m base",
    );

    run(&work, "git checkout -b feature");
    std::fs::write(work.join("feat.txt"), b"feat\n").unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m feature-change",
    );

    run(&work, "git checkout main");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test merge --no-ff feature -m merge-feature",
    );

    std::fs::write(work.join("main.txt"), b"main\n").unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m main-after-merge",
    );

    let out = crate::diff::refs::diff_refs(GitDiffOptions {
        baseRef: Some("main".into()),
        headRef: "feature".into(),
        repoFullName: None,
        repoUrl: None,
        teamSlugOrId: None,
        originPathOverride: Some(work.to_string_lossy().to_string()),
        includeContents: Some(true),
        maxBytes: Some(1024 * 1024),
        lastKnownBaseSha: None,
        lastKnownMergeCommitSha: None,
    })
    .unwrap();
    assert_eq!(
        out.len(),
        0,
        "Expected no differences after merge, got: {:?}",
        out
    );
}

#[test]
fn refs_diff_numstat_matches_known_pairs() {
    // Ensure we run against the repo root so refs are available
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = find_git_root(manifest_dir);
    // Proactively fetch to make sure remote-only commits are present locally
    run(&repo_root, "git fetch --all --tags --prune");

    let cases = vec![
        (
            "63f3bf66676b5bc7d495f6aaacabe75895ff2045",
            "0ae5f5b2098b4d7c5f3185943251fba8ee791575",
            6,
            30,
        ),
        (
            "7a985028c3ecc57f110d91191a4d000c39f0a63e",
            "5f7d671ca484360df34e363511a0dd60ebe25c79",
            294,
            255,
        ),
        (
            "4a886e5e769857b9af000224a33460f96fa66545",
            "08db1fe57536b2832a75b8eff5c1955e735157e6",
            512,
            232,
        ),
        (
            "2f5f387feee44af6d540da544a0501678dcc2538",
            "2b292770f68d8c097420bd70fd446ca22a88ec62",
            3,
            3,
        ),
    ];

    for (from, to, exp_adds, exp_dels) in cases {
        let out = crate::diff::refs::diff_refs(GitDiffOptions {
            baseRef: Some(from.into()),
            headRef: to.into(),
            repoFullName: None,
            repoUrl: None,
            teamSlugOrId: None,
            originPathOverride: Some(repo_root.to_string_lossy().to_string()),
            includeContents: Some(true),
            maxBytes: Some(10 * 1024 * 1024),
            lastKnownBaseSha: None,
            lastKnownMergeCommitSha: None,
        })
        .expect("diff refs");
        let adds: i32 = out.iter().map(|e| e.additions).sum();
        let dels: i32 = out.iter().map(|e| e.deletions).sum();
        assert_eq!(
            (adds, dels),
            (exp_adds, exp_dels),
            "mismatch for {}..{} entries={}",
            from,
            to,
            out.len()
        );
    }
}

#[test]
fn refs_diff_handles_binary_files() {
    let tmp = tempdir().unwrap();
    let work = tmp.path().join("repo");
    std::fs::create_dir_all(&work).unwrap();
    run(&work, "git init");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test checkout -b main",
    );

    // Commit an initial binary file with NUL bytes
    let bin1: Vec<u8> = vec![0, 159, 146, 150, 0, 1, 2, 3, 4, 5];
    std::fs::write(work.join("bin.dat"), &bin1).unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m init",
    );
    let c1 = String::from_utf8(
        Command::new(if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        })
        .arg(if cfg!(target_os = "windows") {
            "/C"
        } else {
            "-c"
        })
        .arg("git rev-parse HEAD")
        .current_dir(&work)
        .output()
        .unwrap()
        .stdout,
    )
    .unwrap();
    let c1 = c1.trim().to_string();

    // Modify the binary file
    let mut bin2 = bin1.clone();
    bin2.extend_from_slice(&[6, 7, 8, 9, 0]);
    std::fs::write(work.join("bin.dat"), &bin2).unwrap();
    run(&work, "git add .");
    run(
        &work,
        "git -c user.email=a@b -c user.name=test commit -m update",
    );
    let c2 = String::from_utf8(
        Command::new(if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        })
        .arg(if cfg!(target_os = "windows") {
            "/C"
        } else {
            "-c"
        })
        .arg("git rev-parse HEAD")
        .current_dir(&work)
        .output()
        .unwrap()
        .stdout,
    )
    .unwrap();
    let c2 = c2.trim().to_string();

    let out = crate::diff::refs::diff_refs(GitDiffOptions {
        baseRef: Some(c1.clone()),
        headRef: c2.clone(),
        repoFullName: None,
        repoUrl: None,
        teamSlugOrId: None,
        originPathOverride: Some(work.to_string_lossy().to_string()),
        includeContents: Some(true),
        maxBytes: Some(1024 * 1024),
        lastKnownBaseSha: None,
        lastKnownMergeCommitSha: None,
    })
    .expect("diff refs binary");

    let bin_entry = out
        .iter()
        .find(|e| e.filePath == "bin.dat")
        .expect("binary entry");
    assert!(bin_entry.isBinary, "binary file should be detected");
    assert_eq!(bin_entry.additions, 0);
    assert_eq!(bin_entry.deletions, 0);
}

#[cfg(feature = "fuzz-tests")]
#[test]
#[ignore]
fn fuzz_merge_commit_inference_matches_github() {
    let truth = ground_truth();
    // Warm repositories sequentially before spawning worker threads
    for repo_slug in truth.repos.keys() {
        let base = ensure_repo_with_pull_refs(repo_slug);
        let _ = canonicalize_path(&base);
    }

    let tasks: Vec<&PullRequestRecord> = truth.repos.values().flat_map(|prs| prs.iter()).collect();

    let thread_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let pool = ThreadPoolBuilder::new()
        .num_threads(thread_count)
        .build()
        .expect("build rayon pool");

    let aggregated = pool.install(|| {
        tasks
            .par_iter()
            .map(|pr| evaluate_merge_pr(pr))
            .fold(
                || (MergeStats::default(), Vec::new()),
                |mut acc, (stats, mismatch)| {
                    acc.0.accumulate(&stats);
                    if let Some(m) = mismatch {
                        acc.1.push(m);
                    }
                    acc
                },
            )
            .reduce(
                || (MergeStats::default(), Vec::new()),
                |mut acc, item| {
                    acc.0.accumulate(&item.0);
                    acc.1.extend(item.1);
                    acc
                },
            )
    });

    let aggregated_stats = &aggregated.0;

    println!(
    "[merge-summary] total_with_merge={} matches={} (fallback={}) matches_second_parent={} compare_equal_head={} mismatches={} single_parent={} missing_commits={} (after_fetch={}) fetch_attempts={} fetch_success={} fallback_used={} no_merge_commit={}",
    aggregated_stats.total_with_merge,
    aggregated_stats.matches,
    aggregated_stats.fallback_matches,
    aggregated_stats.matches_second_parent,
    aggregated_stats.compare_equal_head,
    aggregated_stats.mismatches,
    aggregated_stats.single_parent,
    aggregated_stats.missing_commits,
    aggregated_stats.missing_after_fetch,
    aggregated_stats.fetch_attempts,
    aggregated_stats.fetch_success,
    aggregated_stats.fallback_used,
    aggregated_stats.no_merge_commit,
  );

    if !aggregated.1.is_empty() {
        println!(
            "[merge-summary] unmatched_with_merge_oid={} entries (showing up to 10):",
            aggregated_stats.unmatched_with_merge_oid
        );
        for m in aggregated.1.iter().take(10) {
            println!(
                "  - {}#{} compare={} base_parent={} head_parent={} merge_commit={:?} reason={}",
                m.repo,
                m.number,
                m.compare_base,
                m.base_parent,
                m.head_parent,
                m.merge_commit,
                m.reason,
            );
        }
    }

    assert_eq!(
        aggregated_stats.compare_equal_head, 0,
        "compare_base matched head for some PRs"
    );
}

#[test]
#[ignore]
fn debug_single_pr() {
    let truth = ground_truth();
    let target_repo =
        std::env::var("DEBUG_PR_REPO").unwrap_or_else(|_| "manaflow-ai/cmux".to_string());
    let target_number: u64 = std::env::var("DEBUG_PR_NUMBER")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(186);
    for pr in truth
        .repos
        .get(&target_repo)
        .into_iter()
        .flat_map(|prs| prs.iter())
    {
        if pr.number == target_number {
            let cached = compute_diff_for_pr(pr);
            println!("debug={:?}", cached.debug);
            println!("base_repo={:?}", cached.base_repo_path);
            if let Some(merge_sha) = &pr.merge_commit_sha {
                ensure_merge_commit(&cached.base_repo_path, pr.number, merge_sha);
                let parents = commit_parents(&cached.base_repo_path, merge_sha);
                println!("parents={:?}", parents);
            }
            return;
        }
    }
    panic!("PR not found");
}

#[cfg(feature = "fuzz-tests")]
#[test]
#[ignore]
fn fuzz_diff_stats_match_github_ground_truth() {
    let truth = ground_truth();
    let target_repo_filter = std::env::var("DIFF_STATS_REPO").ok();
    let target_number_filter: Option<u64> = std::env::var("DIFF_STATS_PR")
        .ok()
        .and_then(|v| v.parse().ok());
    let mut checked = 0usize;
    let mut matched = 0usize;
    let mut mismatched_entries: Vec<(String, u64)> = Vec::new();
    for prs in truth.repos.values() {
        for pr in prs {
            if let Some(repo_filter) = &target_repo_filter {
                if &pr.repo != repo_filter {
                    continue;
                }
            }
            if let Some(num_filter) = target_number_filter {
                if pr.number != num_filter {
                    continue;
                }
            }
            let (stats, mismatch) = evaluate_merge_pr(pr);
            if stats.matches == 0 {
                if let Some(m) = mismatch {
                    println!(
            "[diff-stats] skipping {}#{} due to merge mismatch: compare={} expected={} head_parent={} reason={}",
            m.repo,
            m.number,
            m.compare_base,
            m.base_parent,
            m.head_parent,
            m.reason,
          );
                }
                continue;
            }
            checked += 1;
            println!(
        "[diff-stats] checking {}#{} (additions_gt={} deletions_gt={} files_gt={} merge_match={} second_parent_match={})",
        pr.repo,
        pr.number,
        pr.additions,
        pr.deletions,
        pr.changed_files,
        stats.matches,
        stats.matches_second_parent,
      );
            let cached = compute_diff_for_pr(pr);
            let mut mismatched = false;
            if cached.additions != pr.additions {
                mismatched = true;
                println!(
                    "[diff-stats] additions mismatch for {}#{} ours={} github={}",
                    pr.repo, pr.number, cached.additions, pr.additions,
                );
            }
            if cached.deletions != pr.deletions {
                mismatched = true;
                println!(
                    "[diff-stats] deletions mismatch for {}#{} ours={} github={}",
                    pr.repo, pr.number, cached.deletions, pr.deletions,
                );
            }
            if cached.changed_files as i64 != pr.changed_files {
                mismatched = true;
                println!(
                    "[diff-stats] changed_files mismatch for {}#{} ours={} github={}",
                    pr.repo, pr.number, cached.changed_files, pr.changed_files,
                );
            }
            if mismatched {
                mismatched_entries.push((pr.repo.clone(), pr.number));
                println!(
                    "[diff-stats] mismatch detail compare={} head={} merge_commit={:?}",
                    cached.debug.compare_base_oid, cached.debug.head_oid, pr.merge_commit_sha,
                );
            } else {
                matched += 1;
            }
        }
    }
    println!(
        "[diff-stats-summary] checked={} matched={} mismatched={}",
        checked,
        matched,
        mismatched_entries.len(),
    );
    if !mismatched_entries.is_empty() {
        for (repo, number) in mismatched_entries.iter().take(20) {
            println!("  - {}#{}", repo, number);
        }
    }
    assert!(checked > 0, "no PRs with verified merge bases");
}
