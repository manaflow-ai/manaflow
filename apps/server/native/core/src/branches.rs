use anyhow::Result;
use gix::bstr::ByteSlice;
use gix::hash::ObjectId;

use crate::repo::cache::{ensure_repo, resolve_repo_url, swr_fetch_origin_all_path};
use crate::types::{BranchInfo, GitListRemoteBranchesOptions};

fn refname_to_branch(name: &str) -> Option<(String /*remote*/, String /*branch*/)> {
    // Expect refs/remotes/<remote>/<branch>
    let p = name.strip_prefix("refs/remotes/")?;
    let mut it = p.splitn(2, '/');
    let remote = it.next().unwrap_or("");
    let branch = it.next().unwrap_or("");
    if branch.is_empty() || branch == "HEAD" {
        return None;
    }
    Some((remote.to_string(), branch.to_string()))
}

fn oid_to_hex(oid: ObjectId) -> String {
    oid.to_hex().to_string()
}

pub fn list_remote_branches(opts: GitListRemoteBranchesOptions) -> Result<Vec<BranchInfo>> {
    // Resolve local repo path
    let repo_path = if let Some(p) = &opts.originPathOverride {
        std::path::PathBuf::from(p)
    } else {
        let url = resolve_repo_url(opts.repoFullName.as_deref(), opts.repoUrl.as_deref())?;
        ensure_repo(&url)?
    };

    // Make sure remotes are fresh (this is cheap if within SWR window)
    let _ = swr_fetch_origin_all_path(&repo_path, crate::repo::cache::fetch_window_ms());

    let repo = gix::open(&repo_path)?;

    // Iterate remote refs and assemble info
    let refs = repo.references()?;
    let mut out: Vec<BranchInfo> = Vec::new();
    let iter = refs.all()?;

    // Determine origin/HEAD target branch (short name)
    let mut origin_head_short: Option<String> = None;
    if let Ok(head_ref) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Some(name) = head_ref.target().try_name() {
            let s = name.as_bstr().to_str_lossy().into_owned();
            if let Some((remote, short)) = refname_to_branch(&s) {
                if remote == "origin" {
                    origin_head_short = Some(short);
                }
            }
        }
    }

    for r in iter {
        let r = match r {
            Ok(v) => v,
            Err(_) => continue,
        };
        let name = r.name().as_bstr().to_str_lossy().into_owned();
        if !name.starts_with("refs/remotes/") {
            continue;
        }
        let Some((remote, short)) = refname_to_branch(&name) else {
            continue;
        };
        if remote != "origin" {
            continue;
        }

        // Resolve target OID (skip symbolic remote/HEAD)
        let tgt = r.target();
        let Some(id_ref) = tgt.try_id() else { continue };
        let id: ObjectId = id_ref.to_owned();
        // Read commit to get committer time; if it's not a commit, skip time
        let mut last_ts: Option<i64> = None;
        if let Ok(obj) = repo.find_object(id) {
            if let Ok(commit) = obj.try_into_commit() {
                // Prefer committer time, then author time
                let t = commit
                    .committer()
                    .ok()
                    .map(|sig| sig.time)
                    .or_else(|| commit.author().ok().map(|sig| sig.time));
                if let Some(t) = t {
                    last_ts = Some(t.seconds * 1000);
                }
            }
        }

        let is_default = origin_head_short
            .as_ref()
            .map(|h| h == &short)
            .unwrap_or(false);
        out.push(BranchInfo {
            name: short,
            lastCommitSha: Some(oid_to_hex(id)),
            lastActivityAt: last_ts,
            isDefault: Some(is_default),
            lastKnownBaseSha: None,
            lastKnownMergeCommitSha: None,
        });
    }

    // Sort: pin main/dev/master/develop first; then by activity desc; then name asc
    fn pin_rank(name: &str) -> i32 {
        match name {
            "main" => 0,
            "dev" => 1,
            "master" => 2,
            "develop" => 3,
            _ => i32::MAX,
        }
    }

    let head = origin_head_short.clone();
    out.sort_by(|a, b| {
        if let Some(h) = &head {
            let a_is_head = &a.name == h;
            let b_is_head = &b.name == h;
            if a_is_head != b_is_head {
                return if a_is_head {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                };
            }
        }
        let pa = pin_rank(&a.name);
        let pb = pin_rank(&b.name);
        if pa != pb {
            return pa.cmp(&pb);
        }
        let at = a.lastActivityAt.unwrap_or(i64::MIN);
        let bt = b.lastActivityAt.unwrap_or(i64::MIN);
        if at != bt {
            return bt.cmp(&at);
        }
        a.name.cmp(&b.name)
    });

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::run_git;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn lists_and_sorts_origin_remote_branches() {
        let tmp = tempdir().expect("tempdir");
        let root = tmp.path();

        // Create bare origin
        let origin_path = root.join("origin.git");
        fs::create_dir_all(&origin_path).unwrap();
        run_git(
            root.to_str().unwrap(),
            &[
                "init",
                "--bare",
                origin_path.file_name().unwrap().to_str().unwrap(),
            ],
        )
        .expect("init bare");

        // Create seed repo, make branches and commits
        let seed = root.join("seed");
        fs::create_dir_all(&seed).unwrap();
        run_git(seed.to_str().unwrap(), &["init"]).expect("init seed");
        run_git(seed.to_str().unwrap(), &["config", "user.name", "Test"]).unwrap();
        run_git(
            seed.to_str().unwrap(),
            &["config", "user.email", "test@example.com"],
        )
        .unwrap();
        // main branch with initial commit
        run_git(seed.to_str().unwrap(), &["checkout", "-b", "main"]).unwrap();
        fs::write(seed.join("a.txt"), b"one").unwrap();
        run_git(seed.to_str().unwrap(), &["add", "."]).unwrap();
        run_git(seed.to_str().unwrap(), &["commit", "-m", "initial"]).unwrap();
        // dev branch with a commit
        run_git(seed.to_str().unwrap(), &["checkout", "-b", "dev"]).unwrap();
        fs::write(seed.join("a.txt"), b"two").unwrap();
        run_git(seed.to_str().unwrap(), &["commit", "-am", "dev1"]).unwrap();
        // feature branch with a commit
        run_git(seed.to_str().unwrap(), &["checkout", "-b", "feature"]).unwrap();
        fs::write(seed.join("a.txt"), b"three").unwrap();
        run_git(seed.to_str().unwrap(), &["commit", "-am", "feature1"]).unwrap();
        // Bump main to be most recent
        run_git(seed.to_str().unwrap(), &["checkout", "main"]).unwrap();
        fs::write(seed.join("a.txt"), b"main2").unwrap();
        run_git(seed.to_str().unwrap(), &["commit", "-am", "main2"]).unwrap();

        // Push to origin
        let origin_url = origin_path.to_string_lossy().to_string();
        run_git(
            seed.to_str().unwrap(),
            &["remote", "add", "origin", &origin_url],
        )
        .unwrap();
        run_git(seed.to_str().unwrap(), &["push", "-u", "origin", "main"]).unwrap();
        run_git(
            origin_path.to_str().unwrap(),
            &["symbolic-ref", "HEAD", "refs/heads/main"],
        )
        .unwrap();
        run_git(seed.to_str().unwrap(), &["push", "-u", "origin", "dev"]).unwrap();
        run_git(seed.to_str().unwrap(), &["push", "-u", "origin", "feature"]).unwrap();

        // Fresh clone to obtain refs/remotes/origin/*
        let clone = root.join("clone");
        run_git(
            root.to_str().unwrap(),
            &[
                "clone",
                &origin_url,
                clone.file_name().unwrap().to_str().unwrap(),
            ],
        )
        .unwrap();

        let res = list_remote_branches(GitListRemoteBranchesOptions {
            repoFullName: None,
            repoUrl: None,
            originPathOverride: Some(clone.to_string_lossy().to_string()),
        })
        .expect("list branches");
        let names: Vec<String> = res.iter().map(|b| b.name.clone()).collect();

        // Expect pinned and sorted: main first, dev second
        let idx_main = names.iter().position(|n| n == "main").unwrap();
        let idx_dev = names.iter().position(|n| n == "dev").unwrap();
        let idx_feat = names.iter().position(|n| n == "feature").unwrap();
        assert_eq!(idx_main, 0, "main should be first");
        assert_eq!(idx_dev, 1, "dev should be second due to pinning");
        assert!(idx_feat >= 2, "feature should come after pinned branches");

        // Verify isDefault marker for main
        let main_row = res.iter().find(|b| b.name == "main").unwrap();
        assert_eq!(main_row.isDefault, Some(true));
    }
}
