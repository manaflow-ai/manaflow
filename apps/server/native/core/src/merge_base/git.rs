use gix::hash::ObjectId;

pub fn merge_base_git(repo_path: &str, a: ObjectId, b: ObjectId) -> Option<ObjectId> {
    if let Ok(out) =
        crate::util::run_git(repo_path, &["merge-base", &a.to_string(), &b.to_string()])
    {
        if let Some(line) = out.lines().next() {
            let hex = line.trim();
            if let Ok(oid) = ObjectId::from_hex(hex.as_bytes()) {
                return Some(oid);
            }
        }
    }
    None
}
