use std::borrow::Cow;

/// Legacy refresh normalization, not a statement of SQL semantic equivalence.
///
/// Kept in one framework-free helper for both the refresh and the independent comparison.
pub fn comparable_text(text: &str) -> Cow<'_, str> {
    let needs_work = text.contains('\r')
        || text.starts_with('\n')
        || text.ends_with(['\n', ' ', '\t'])
        || text.contains(" \n")
        || text.contains("\t\n");
    if !needs_work {
        return Cow::Borrowed(text);
    }
    let unified = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = unified
        .split('\n')
        .map(|line| line.trim_end_matches([' ', '\t']))
        .collect();
    let first = lines.iter().position(|line| !line.is_empty());
    let last = lines.iter().rposition(|line| !line.is_empty());
    match (first, last) {
        (Some(first), Some(last)) => {
            Cow::Owned(lines.get(first..=last).unwrap_or_default().join("\n"))
        }
        _ => Cow::Owned(String::new()),
    }
}
