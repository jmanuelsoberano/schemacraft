use std::collections::BTreeMap;

/// An object of the previous snapshot, of the current one, or of both, matched by key.
pub(super) enum Pairing<'a, T> {
    /// Only in the current snapshot.
    Added(&'a T),
    /// Only in the previous snapshot.
    Removed(&'a T),
    /// In both snapshots.
    Both {
        /// The previous object.
        previous: &'a T,
        /// The current object.
        current: &'a T,
    },
}

/// Matches two lists by `key` and yields the pairings in key order.
pub(super) fn pair_by_key<'a, T, K: Ord>(
    previous: &'a [T],
    current: &'a [T],
    key: impl Fn(&'a T) -> K,
) -> Vec<Pairing<'a, T>> {
    let mut sides: BTreeMap<K, (Option<&'a T>, Option<&'a T>)> = BTreeMap::new();
    for item in previous {
        sides.entry(key(item)).or_default().0 = Some(item);
    }
    for item in current {
        sides.entry(key(item)).or_default().1 = Some(item);
    }

    sides
        .into_values()
        .filter_map(|sides| match sides {
            (Some(previous), Some(current)) => Some(Pairing::Both { previous, current }),
            (Some(removed), None) => Some(Pairing::Removed(removed)),
            (None, Some(added)) => Some(Pairing::Added(added)),
            (None, None) => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Pairing, pair_by_key};

    #[test]
    fn pairs_items_in_key_order() {
        let previous = ["b", "a", "c"];
        let current = ["c", "d", "a"];

        let pairings = pair_by_key(&previous, &current, |item| *item);
        let rendered: Vec<String> = pairings
            .iter()
            .map(|pairing| match pairing {
                Pairing::Added(item) => format!("+{item}"),
                Pairing::Removed(item) => format!("-{item}"),
                Pairing::Both { previous, current } => format!("={previous}{current}"),
            })
            .collect();

        assert_eq!(rendered, ["=aa", "-b", "=cc", "+d"]);
    }
}
