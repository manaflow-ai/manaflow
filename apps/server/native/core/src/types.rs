#![allow(non_snake_case)]
use napi_derive::napi;

#[napi(object)]
#[derive(Default, Debug, Clone)]
pub struct DiffEntry {
    pub filePath: String,
    pub oldPath: Option<String>,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub isBinary: bool,
    pub contentOmitted: Option<bool>,
    pub oldContent: Option<String>,
    pub newContent: Option<String>,
    pub oldSize: Option<i32>,
    pub newSize: Option<i32>,
    pub patchSize: Option<i32>,
    pub patch: Option<String>,
}

#[napi(object)]
#[derive(Default, Debug, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub lastCommitSha: Option<String>,
    pub lastActivityAt: Option<i64>,
    pub isDefault: Option<bool>,
    pub lastKnownBaseSha: Option<String>,
    pub lastKnownMergeCommitSha: Option<String>,
}

#[napi(object)]
#[derive(Default, Debug, Clone)]
pub struct GitListRemoteBranchesOptions {
    pub repoFullName: Option<String>,
    pub repoUrl: Option<String>,
    pub originPathOverride: Option<String>,
}

#[cfg(test)]
#[derive(Default, Debug, Clone)]
pub struct GitDiffWorkspaceOptions {
    pub worktreePath: String,
    pub includeContents: Option<bool>,
    pub maxBytes: Option<i32>,
}

#[napi(object)]
#[derive(Default, Debug, Clone)]
pub struct GitDiffOptions {
    pub headRef: String,
    pub baseRef: Option<String>,
    pub repoFullName: Option<String>,
    pub repoUrl: Option<String>,
    pub teamSlugOrId: Option<String>,
    pub originPathOverride: Option<String>,
    pub includeContents: Option<bool>,
    pub maxBytes: Option<i32>,
    pub lastKnownBaseSha: Option<String>,
    pub lastKnownMergeCommitSha: Option<String>,
}
