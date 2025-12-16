use gix::hash::ObjectId;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum MergeBaseStrategy {
    Git,
    Bfs,
}

pub fn merge_base(
    cwd: &str,
    repo: &gix::Repository,
    a: ObjectId,
    b: ObjectId,
    strat: MergeBaseStrategy,
) -> Option<ObjectId> {
    match strat {
        MergeBaseStrategy::Git => git::merge_base_git(cwd, a, b),
        MergeBaseStrategy::Bfs => bfs::merge_base_bfs(repo, a, b),
    }
}

pub mod bfs;
pub mod git;

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    use tempfile::tempdir;

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

    #[test]
    fn merge_base_correctness_small_repo() {
        let tmp = tempdir().unwrap();
        let repo_dir = tmp.path().join("repo");
        fs::create_dir_all(&repo_dir).unwrap();
        run(&repo_dir, "git init");
        run(
            &repo_dir,
            "git -c user.email=a@b -c user.name=test checkout -b main",
        );
        fs::write(repo_dir.join("file.txt"), "base\n").unwrap();
        run(&repo_dir, "git add .");
        run(
            &repo_dir,
            "git -c user.email=a@b -c user.name=test commit -m base",
        );
        run(&repo_dir, "git checkout -b feature");

        let n = 60;
        for i in 1..=n {
            fs::write(repo_dir.join("file.txt"), format!("f{}\n", i)).unwrap();
            run(&repo_dir, "git add .");
            run(
                &repo_dir,
                &format!("git -c user.email=a@b -c user.name=test commit -m f{}", i),
            );
        }
        run(&repo_dir, "git checkout main");
        for i in 1..=n {
            fs::write(repo_dir.join("file.txt"), format!("m{}\n", i)).unwrap();
            run(&repo_dir, "git add .");
            run(
                &repo_dir,
                &format!("git -c user.email=a@b -c user.name=test commit -m m{}", i),
            );
        }

        let repo = gix::open(&repo_dir).unwrap();
        let main_oid = repo
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .try_id()
            .unwrap()
            .to_owned();
        let feat_oid = repo
            .find_reference("refs/heads/feature")
            .unwrap()
            .target()
            .try_id()
            .unwrap()
            .to_owned();

        let via_git = git::merge_base_git(&repo_dir.to_string_lossy(), main_oid, feat_oid).unwrap();
        let via_bfs = bfs::merge_base_bfs(&repo, main_oid, feat_oid).unwrap();
        assert_eq!(via_git, via_bfs, "merge-base mismatch");
    }
}
